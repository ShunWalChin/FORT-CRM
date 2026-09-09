/**
 * Federação de instâncias — uma empresa, um banco, um processo lógico.
 *
 * A mudança em relação ao desenho anterior: as empresas deixaram de dividir um
 * arquivo de banco com `empresa_id` como fronteira e passaram a ter cada uma o
 * SEU banco. O isolamento vira físico. Não existe consulta mal escrita capaz de
 * atravessar de uma para a outra, porque a linha da outra não está no arquivo.
 *
 * O escopo por `empresa_id` CONTINUA em toda tabela, e isso não é redundância
 * esquecida: é defesa em profundidade, é o que permite uma instância hospedar
 * mais de uma empresa quando fizer sentido comercial, e é o que mantém válidos
 * os testes de isolamento lógico. Duas barreiras independentes; nenhuma delas
 * confia na outra.
 *
 * A leitura de várias empresas ao mesmo tempo NÃO usa `ATTACH DATABASE`. Seria
 * mais curto, mas amarraria a federação a "todos os bancos no mesmo disco" — e
 * o desenho previsto é justamente o contrário: cada empresa numa instância que
 * pode virar outra VPS. Consultar cada instância e juntar em memória mantém a
 * mesma forma de código quando a instância estiver do outro lado da rede.
 */

import { readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Banco } from './db.mjs';

/** Código reservado: a instância que consolida leads de todas as fontes. */
export const CENTRAL = 'CENTRAL';

/**
 * Catálogo das empresas do grupo. Cada uma vira um arquivo de banco próprio.
 * Acrescentar empresa aqui é o único passo necessário — a federação, o menu, a
 * consolidação e os testes leem desta lista.
 */
export const CATALOGO = [
  {
    codigo: 'MP',
    nome: 'Minas Peças Januária',
    segmento: 'Injeção diesel — Bosch Car Service',
    nicho: 'oficina',
    cor: '#00b8c4',
    whatsapp: '5538998491017',
    cidade: 'Januária/MG',
  },
  {
    codigo: 'AF',
    nome: 'Fazenda Agrofort',
    segmento: 'Queijo artesanal e derivados',
    nicho: 'alimentos',
    cor: '#c42060',
    whatsapp: '5538998492020',
    cidade: 'Januária/MG',
  },
  {
    codigo: 'FT',
    nome: 'Fort Tintas',
    segmento: 'Tintas, vernizes e acessórios',
    nicho: 'varejo',
    cor: '#e8a33d',
    whatsapp: '5538998493030',
    cidade: 'Januária/MG',
  },
];

export function metaDe(codigo) {
  return CATALOGO.find((e) => e.codigo === codigo) ?? null;
}

export class Federacao {
  #dir;
  #abertos = new Map();

  constructor(dir) {
    this.#dir = dir;
    mkdirSync(dir, { recursive: true });
  }

  get diretorio() {
    return this.#dir;
  }

  caminhoDe(codigo) {
    return join(this.#dir, `${String(codigo).toLowerCase()}.db`);
  }

  /** Abre (e memoriza) a conexão de uma instância de empresa. */
  abrir(codigo) {
    const cod = String(codigo).toUpperCase();
    if (cod === CENTRAL) return this.abrirCentral();
    if (!metaDe(cod)) throw new Error(`instância desconhecida: ${codigo}`);
    if (!this.#abertos.has(cod)) {
      this.#abertos.set(cod, new Banco(this.caminhoDe(cod)));
    }
    return this.#abertos.get(cod);
  }

  /**
   * A central tem esquema PRÓPRIO, não o de uma empresa. Dar a ela as mesmas
   * tabelas convidaria alguém a operar dentro dela, e o isolamento por
   * instância perderia o sentido — dar a ela as tabelas de uma empresa
   * convidaria alguém a operar dentro dela.
   *
   * O que ela ganhou foi outra coisa: as tabelas `erp_*`, do ERP do grupo, que
   * são fonte de verdade do que é do GRUPO — plano de contas, razão, títulos.
   * Não são o trabalho de nenhuma empresa; são o livro que soma as três.
   */
  abrirCentral() {
    if (!this.#abertos.has(CENTRAL)) {
      this.#abertos.set(CENTRAL, new Banco(this.caminhoDe(CENTRAL), { central: true }));
    }
    return this.#abertos.get(CENTRAL);
  }

  central() {
    return this.abrirCentral();
  }

  /** Só as instâncias de empresa — a central não é uma empresa. */
  codigosDeEmpresa() {
    return CATALOGO.map((e) => e.codigo);
  }

  /** Instâncias já materializadas em disco. */
  existentes() {
    if (!existsSync(this.#dir)) return [];
    return readdirSync(this.#dir)
      .filter((f) => f.endsWith('.db'))
      .map((f) => f.replace(/\.db$/, '').toUpperCase());
  }

  /**
   * Executa `fn(banco, meta)` em cada instância pedida.
   *
   * Uma instância que falha NÃO derruba a consulta inteira: ela volta com
   * `erro` preenchido e as outras seguem. Numa federação em que cada empresa
   * pode estar em outra máquina, indisponibilidade de uma é evento normal — e
   * um painel do grupo que apaga por causa de uma filial fora do ar é pior que
   * um painel que mostra três de quatro e diz qual faltou.
   */
  emCada(codigos, fn) {
    const alvos = (codigos?.length ? codigos : this.codigosDeEmpresa())
      .map((c) => String(c).toUpperCase());

    return alvos.map((codigo) => {
      const meta = metaDe(codigo);
      try {
        return { instancia: codigo, meta, dados: fn(this.abrir(codigo), meta), erro: null };
      } catch (e) {
        return { instancia: codigo, meta, dados: null, erro: e.message };
      }
    });
  }

  /**
   * Consulta federada: roda `fn` em cada instância, espera um array de linhas e
   * devolve tudo junto, com cada linha carimbada com a instância de origem.
   * O carimbo não é enfeite — sem ele, duas linhas de empresas diferentes com
   * o mesmo id viram a mesma linha na tela.
   */
  consultar(codigos, fn) {
    const partes = this.emCada(codigos, fn);
    const linhas = [];
    const falhas = [];

    for (const p of partes) {
      if (p.erro) {
        falhas.push({ instancia: p.instancia, erro: p.erro });
        continue;
      }
      for (const linha of p.dados ?? []) {
        linhas.push({ ...linha, _instancia: p.instancia, _empresa: p.meta?.nome ?? p.instancia });
      }
    }
    /*
     * `completo` e obrigatorio no contrato, e nao um extra.
     *
     * Sem ele, uma consulta que nao alcancou uma instancia devolve uma lista
     * que PARECE completa: quem soma nao tem como saber que faltou empresa, e
     * um consolidado com duas de tres parece certo e esta errado. `falhas` ja
     * existia e podia ser ignorado sem esforco — um booleano na cara obriga a
     * decidir o que fazer.
     */
    return {
      linhas,
      falhas,
      completo: falhas.length === 0,
      instanciasConsultadas: partes.map((p) => p.instancia),
    };
  }

  fecharTudo() {
    for (const b of this.#abertos.values()) b.fechar();
    this.#abertos.clear();
  }
}
