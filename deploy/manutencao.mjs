/**
 * Manutenção do FORT-CRM hospedado. Roda DENTRO do contêiner, por timer.
 *
 * Duas tarefas, e as duas existem por um problema já observado:
 *
 * 1. BACKUP com `VACUUM INTO`, nunca cópia de arquivo.
 *
 *    Medido no servidor: os `.db` têm 4 KB e os `-wal` têm 832 KB. O SQLite em
 *    modo WAL mantém as escritas recentes no arquivo lateral, e só as move para
 *    o `.db` num checkpoint. Copiar o `.db` sozinho — que é o reflexo de quem
 *    faz backup com `cp` — produz um arquivo íntegro, abrível, e VAZIO. O erro
 *    só aparece no dia em que alguém precisa restaurar.
 *
 *    `VACUUM INTO` lê a base pela engine, com o WAL aplicado, e escreve um
 *    arquivo único e consistente sem travar quem está escrevendo.
 *
 * 2. REANCORAR a demonstração.
 *
 *    A carga gera datas relativas ao instante em que roda, e o compliance —
 *    funcionando corretamente — vai fechando a janela de 24 h conforme o
 *    relógio anda. Nove horas depois da carga a fila da oficina já havia
 *    encolhido de 16 liberados para 9. Num link permanente que o cliente abre
 *    quando quiser, isso significa abrir numa tela vazia.
 *
 *    Reancorar desliza a história para frente sem apagar nada — preserva
 *    auditoria, disparos e conversões.
 */

import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Federacao, CATALOGO } from '../src/federacao.mjs';
import { reancorar, diagnosticoDaAncora } from '../src/reancorar.mjs';
import { sincronizarCentral } from '../src/central.mjs';

const DIR_DADOS = process.env.FORTCRM_DIR ?? '/dados/instancias';
const DIR_BACKUP = process.env.FORTCRM_BACKUP ?? '/dados/backups';
const MANTER = Number(process.env.FORTCRM_BACKUP_MANTER ?? 14);

const carimbo = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const log = (...a) => console.log(new Date().toISOString(), ...a);

const fed = new Federacao(DIR_DADOS);

/* ── Backup ───────────────────────────────────────────────────────────────── */

function fazerBackup() {
  mkdirSync(DIR_BACKUP, { recursive: true });
  const pasta = join(DIR_BACKUP, carimbo());
  mkdirSync(pasta, { recursive: true });

  const feitos = [];
  for (const cod of [...CATALOGO.map((e) => e.codigo), 'CENTRAL']) {
    try {
      const banco = cod === 'CENTRAL' ? fed.abrirCentral() : fed.abrir(cod);
      const destino = join(pasta, `${cod.toLowerCase()}.db`);
      banco.sistema().exec(`vacuum into '${destino.replace(/'/g, "''")}'`);

      /*
       * Conferir o tamanho não é paranoia: um backup de 4 KB é exatamente o
       * sintoma de banco vazio, e falhar aqui é muito melhor do que descobrir
       * na restauração.
       */
      const bytes = statSync(destino).size;
      if (bytes < 8192) throw new Error(`backup de ${cod} saiu com ${bytes} bytes — suspeito de vazio`);
      feitos.push({ instancia: cod, bytes });
    } catch (e) {
      log(`ERRO no backup de ${cod}:`, e.message);
      process.exitCode = 1;
    }
  }

  log('backup em', pasta, '—', feitos.map((f) => `${f.instancia}:${Math.round(f.bytes / 1024)}KB`).join(' '));
  return pasta;
}

/** Guarda os N mais recentes. Disco compartilhado não comporta histórico infinito. */
function podarBackups() {
  if (!existsSync(DIR_BACKUP)) return;
  const pastas = readdirSync(DIR_BACKUP)
    .filter((n) => statSync(join(DIR_BACKUP, n)).isDirectory())
    .sort()
    .reverse();

  for (const velha of pastas.slice(MANTER)) {
    rmSync(join(DIR_BACKUP, velha), { recursive: true, force: true });
    log('removido backup antigo', velha);
  }
}

/* ── Reancoragem ──────────────────────────────────────────────────────────── */

function reancorarTudo({ limiteHoras = 10 } = {}) {
  let mexeu = false;
  for (const e of CATALOGO) {
    const banco = fed.abrir(e.codigo);
    const d = diagnosticoDaAncora(banco, { limiteHoras });

    if (!d.envelhecida) {
      log(`${e.codigo}: âncora com ${d.horas ?? '—'} h, dentro do limite`);
      continue;
    }
    const emp = banco.sistema().prepare('select id from empresas limit 1').get();
    const r = reancorar(banco, banco.para(emp.id), { ator: 'manutencao' });
    log(`${e.codigo}: deslizou ${Math.round(r.deslocouSegundos / 3600)} h`);
    mexeu = true;
  }

  // A Central é projeção das instâncias: sem re-sincronizar, ela fica com as
  // datas antigas enquanto as instâncias andaram.
  if (mexeu) {
    sincronizarCentral(fed);
    log('central re-sincronizada');
  }
  return mexeu;
}

/* ── Entrada ──────────────────────────────────────────────────────────────── */

const tarefa = process.argv[2] ?? 'tudo';
try {
  if (tarefa === 'backup' || tarefa === 'tudo') { fazerBackup(); podarBackups(); }
  if (tarefa === 'reancorar' || tarefa === 'tudo') reancorarTudo();
} finally {
  fed.fecharTudo();
}
