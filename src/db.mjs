/**
 * Camada de acesso com contexto de empresa obrigatório.
 *
 * A regra que este módulo existe para aplicar: nenhuma consulta de negócio sai
 * daqui sem `empresa_id` no WHERE. No Palantyr de produção quem garante isso é
 * a RLS do Postgres — o banco recusa. Aqui é código, e código pode ser
 * contornado por quem escrever SQL cru. Por isso o único caminho oferecido é
 * `db.para(empresaId)`: quem quiser atravessar a fronteira precisa chamar
 * `db.grupo(motivo)` e declarar por escrito o motivo, que vai para a auditoria.
 */

import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SCHEMA_SQL } from './schema.mjs';
import { SCHEMA_EXTRA_SQL, SCHEMA_CENTRAL_SQL } from './schema-extra.mjs';
import { SCHEMA_ERP_SQL } from './erp-schema.mjs';
import { COLUNAS_ESPERADAS_CENTRAL, migrarColunas } from './migracoes.mjs';

export function agora() {
  return new Date().toISOString();
}

export function novoId() {
  return randomUUID();
}

/** Consultas consolidadas do grupo exigem motivo textual — doutrina §5. */
const MOTIVOS_VALIDOS = /^[\wçãõáéíóúâêôà .,-]{8,200}$/i;

export class Banco {
  #sql;

  constructor(caminho, { central = false } = {}) {
    const emMemoria = caminho === ':memory:';
    if (!emMemoria) mkdirSync(dirname(caminho), { recursive: true });
    this.#sql = new DatabaseSync(caminho);

    // Sem isto, cada INSERT vira uma transação própria com sincronização em
    // disco. A carga de demonstração são ~250 inserções: no rollback journal
    // padrão isso levava 25 segundos e travava o processo inteiro, porque
    // node:sqlite é síncrono. WAL com `synchronous = normal` é a combinação
    // correta para dado que pode ser regerado — o risco que ela aceita é
    // perder a última transação num corte de energia, e aqui isso não custa
    // nada.
    if (!emMemoria) {
      this.#sql.exec('pragma journal_mode = wal');
      this.#sql.exec('pragma synchronous = normal');
    }
    if (central) {
      this.#sql.exec(SCHEMA_CENTRAL_SQL);
      /*
       * O ERP mora so na central, e a razao e a mesma que fez o razao morar
       * la: partida dobrada exige transacao, e nao ha transacao que atravesse
       * tres arquivos SQLite. Ver `erp-schema.mjs`.
       */
      this.#sql.exec(SCHEMA_ERP_SQL);
    } else {
      this.#sql.exec(SCHEMA_SQL);
      this.#sql.exec(SCHEMA_EXTRA_SQL);
    }

    /*
     * `create table if not exists` resolve o banco novo e NAO resolve o que ja
     * existe: acrescentar coluna ao schema nao muda uma tabela ja criada, e a
     * primeira escrita quebra com "has no column named X" — longe daqui.
     *
     * Aconteceu em producao com `clientes.campos`. Local passava porque a base
     * era apagada e renascia; no servidor, o deploy subiu e a recarga quebrou.
     */
    // Cada esquema migra contra a sua lista. Unir as duas nao daria erro — a
    // migracao ignora tabela ausente — e por isso mesmo esconderia a entrada
    // que foi parar na lista errada: ela simplesmente nunca seria aplicada.
    this.migracoes = migrarColunas(this.#sql, central ? COLUNAS_ESPERADAS_CENTRAL : undefined);

    /*
     * `sem_acento()` dentro do SQL, porque `like` do SQLite nao sabe portugues.
     *
     * Procurar "antonio" nao achava "Antônio Ribeiro" — e num sistema usado no
     * balcao, de celular, ninguem digita o circunflexo. `lower()` do SQLite so
     * dobra ASCII, entao nem o acento nem o Ç saem sozinhos.
     *
     * O preco: SQLite chama JS uma vez por linha avaliada, e nao ha indice que
     * cubra a expressao. Numa base de balcao (milhares de linhas) e imediato;
     * quando passar disso, a resposta e uma coluna `nome_busca` normalizada na
     * escrita e indexada — e nao esticar isto.
     */
    this.#sql.function('sem_acento', { deterministic: true }, (v) => (
      v == null ? null : String(v).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    ));

    this.central = central;
  }

  /**
   * Executa `fn` numa única transação. Em erro, desfaz tudo.
   * Cargas em lote passam por aqui — 250 commits contra 1 é a diferença entre
   * 25 segundos e uma fração de segundo.
   */
  transacao(fn) {
    this.#sql.exec('begin');
    try {
      const r = fn();
      this.#sql.exec('commit');
      return r;
    } catch (e) {
      try { this.#sql.exec('rollback'); } catch { /* já desfeita */ }
      throw e;
    }
  }

  get raw() {
    return this.#sql;
  }

  fechar() {
    this.#sql.close();
  }

  /**
   * Escopo de uma empresa. Todo select/insert/update passa a carregar
   * `empresa_id` automaticamente.
   */
  para(empresaId) {
    if (!empresaId || typeof empresaId !== 'string') {
      throw new Error('contexto de empresa ausente — consulta recusada');
    }
    return new Escopo(this.#sql, empresaId);
  }

  /**
   * Leitura consolidada do grupo, atravessando a fronteira de propósito.
   * Espelha `unsafeSystem()` da doutrina: exige motivo e fica registrado.
   */
  grupo(motivo) {
    if (!MOTIVOS_VALIDOS.test(String(motivo ?? ''))) {
      throw new Error('leitura consolidada exige motivo textual de 8 a 200 caracteres');
    }
    return {
      motivo,
      todas(sql, ...params) {
        return this.__sql.prepare(sql).all(...params);
      },
      __sql: this.#sql,
    };
  }

  /** Consultas globais sem tenant: empresas, usuários, auditoria. */
  sistema() {
    return this.#sql;
  }

  /**
   * Registra em `audit_log` encadeando SHA-256 sobre o último hash.
   * A cadeia DETECTA adulteração; não a impede. Ver README, "limitações".
   */
  auditar({ empresaId = null, ator, acao, entidade = null, entidadeId = null, dados = {} }) {
    const anterior = this.#sql
      .prepare('select hash from audit_log order by seq desc limit 1')
      .get();
    const hashAnterior = anterior?.hash ?? null;
    const criadoEm = agora();
    const payload = JSON.stringify(dados);
    const hash = createHash('sha256')
      .update([hashAnterior ?? '', empresaId ?? '', ator, acao, entidade ?? '', entidadeId ?? '', payload, criadoEm].join('|'))
      .digest('hex');

    this.#sql
      .prepare(
        `insert into audit_log
           (empresa_id, ator, acao, entidade, entidade_id, dados, hash_anterior, hash, criado_em)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(empresaId, ator, acao, entidade, entidadeId, payload, hashAnterior, hash, criadoEm);

    return hash;
  }

  /**
   * Recalcula a cadeia inteira e devolve as quebras encontradas.
   * Zero linhas é o resultado esperado.
   */
  verificarCadeia() {
    const linhas = this.#sql.prepare('select * from audit_log order by seq asc').all();
    const quebras = [];
    let esperadoAnterior = null;

    for (const l of linhas) {
      const recalculado = createHash('sha256')
        .update(
          [
            l.hash_anterior ?? '',
            l.empresa_id ?? '',
            l.ator,
            l.acao,
            l.entidade ?? '',
            l.entidade_id ?? '',
            l.dados,
            l.criado_em,
          ].join('|'),
        )
        .digest('hex');

      if (recalculado !== l.hash) {
        quebras.push({ seq: l.seq, motivo: 'hash nao confere com o conteudo' });
      } else if (l.hash_anterior !== esperadoAnterior) {
        quebras.push({ seq: l.seq, motivo: 'elo anterior nao confere' });
      }
      esperadoAnterior = l.hash;
    }
    return quebras;
  }
}

/** Escopo travado numa empresa. */
class Escopo {
  constructor(sql, empresaId) {
    this.sql = sql;
    this.empresaId = empresaId;
  }

  /**
   * Injeta `empresa_id = ?` como primeiro predicado. `sql` deve conter o
   * marcador {ESCOPO} no lugar do filtro de tenant.
   */
  #aplicar(sql) {
    if (!sql.includes('{ESCOPO}')) {
      throw new Error('consulta sem marcador {ESCOPO} — recusada por seguranca');
    }
    return sql.replaceAll('{ESCOPO}', 'empresa_id = ?');
  }

  todas(sql, ...params) {
    return this.sql.prepare(this.#aplicar(sql)).all(this.empresaId, ...params);
  }

  /** Para consultas com o escopo no meio, passe os params já ordenados. */
  todasOrdenadas(sql, params) {
    return this.sql.prepare(this.#aplicar(sql)).all(...params);
  }

  uma(sql, ...params) {
    return this.sql.prepare(this.#aplicar(sql)).get(this.empresaId, ...params) ?? null;
  }

  contar(tabela, extra = '', ...params) {
    const sql = `select count(*) as n from ${tabela} where {ESCOPO} ${extra}`;
    return this.sql.prepare(this.#aplicar(sql)).get(this.empresaId, ...params).n;
  }

  somar(tabela, coluna, extra = '', ...params) {
    const sql = `select coalesce(sum(${coluna}),0) as t from ${tabela} where {ESCOPO} ${extra}`;
    return this.sql.prepare(this.#aplicar(sql)).get(this.empresaId, ...params).t;
  }

  /** Insert com empresa_id preenchido pelo escopo, nunca pelo corpo da requisição. */
  inserir(tabela, dados) {
    const registro = { ...dados, empresa_id: this.empresaId };
    const colunas = Object.keys(registro);
    const marcadores = colunas.map(() => '?').join(', ');
    this.sql
      .prepare(`insert into ${tabela} (${colunas.join(', ')}) values (${marcadores})`)
      .run(...colunas.map((c) => registro[c]));
    return registro;
  }

  /** Update travado no tenant: linha de outra empresa simplesmente não existe. */
  atualizar(tabela, id, dados) {
    const colunas = Object.keys(dados);
    if (colunas.length === 0) return 0;
    const set = colunas.map((c) => `${c} = ?`).join(', ');
    const r = this.sql
      .prepare(`update ${tabela} set ${set} where id = ? and empresa_id = ?`)
      .run(...colunas.map((c) => dados[c]), id, this.empresaId);
    return r.changes;
  }

  remover(tabela, id) {
    return this.sql
      .prepare(`delete from ${tabela} where id = ? and empresa_id = ?`)
      .run(id, this.empresaId).changes;
  }
}
