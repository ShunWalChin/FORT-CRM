/**
 * Exportação completa — código, dados e documentação.
 *
 * Isto não é utilitário de conveniência: a proposta comercial promete, na
 * cláusula de garantias, que "ao fim do contrato, todo o conteúdo e toda a base
 * são entregues em formato aberto". Uma promessa dessas sem comando que a
 * cumpra é promessa que ninguém testou. Aqui ela é um comando.
 *
 *   node src/exportar.mjs
 *
 * Gera uma pasta com o código-fonte, cada tabela em CSV e em JSON, uma cópia
 * consistente do banco, o DDL, um inventário com SHA-256 de cada arquivo e um
 * manifesto explicando o que é cada coisa.
 *
 * Sobre a cópia do banco: com WAL ligado, o arquivo `.db` sozinho pode estar
 * praticamente vazio — o conteúdo recente vive no `-wal`. Copiar os três
 * arquivos daria certo por acidente e erraria na hora errada. `VACUUM INTO`
 * produz um único arquivo consistente, com o WAL já incorporado, mesmo com o
 * servidor rodando.
 */

import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import {
  cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(dirname(fileURLToPath(import.meta.url)));
const DIR_INSTANCIAS = process.env.FORTCRM_DIR ?? join(AQUI, 'data', 'instancias');

/** Carimbo local, legível e ordenável: 20260824-124700. */
function carimbo(d = new Date()) {
  const p = (n, casas = 2) => String(n).padStart(casas, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Campo CSV conforme RFC 4180: aspas dobradas e o campo inteiro entre aspas. */
function campoCsv(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function paraCsv(linhas, colunas) {
  const cabecalho = colunas.join(',');
  const corpo = linhas.map((l) => colunas.map((c) => campoCsv(l[c])).join(','));
  // BOM para o Excel em português abrir acentuação correta sem perguntar nada.
  return `﻿${[cabecalho, ...corpo].join('\r\n')}\r\n`;
}

function sha256(caminho) {
  return createHash('sha256').update(readFileSync(caminho)).digest('hex');
}

/** Lista recursiva de arquivos, ignorando o que não deve viajar. */
function listar(raiz, ignorar = []) {
  const saida = [];
  const andar = (dir) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const cheio = join(dir, item.name);
      if (ignorar.some((p) => cheio.includes(p))) continue;
      if (item.isDirectory()) andar(cheio);
      else saida.push(cheio);
    }
  };
  andar(raiz);
  return saida;
}

export function exportar({ destinoBase = join(AQUI, 'export'), quando = new Date() } = {}) {
  const marca = carimbo(quando);
  const nome = `fortcrm-export-${marca}`;
  const raiz = join(destinoBase, nome);

  rmSync(raiz, { recursive: true, force: true });
  for (const p of ['codigo', 'codigo/src', 'codigo/web', 'dados', 'documentacao']) {
    mkdirSync(join(raiz, p), { recursive: true });
  }

  // ── Código-fonte ────────────────────────────────────────────────────────
  const arquivosCodigo = [
    ['server.mjs', 'codigo/server.mjs'],
    ['package.json', 'codigo/package.json'],
    ['.gitignore', 'codigo/.gitignore'],
    ['README.md', 'documentacao/README.md'],
    ['ROADMAP.md', 'documentacao/ROADMAP.md'],
  ];
  for (const [de, para] of arquivosCodigo) {
    try {
      cpSync(join(AQUI, de), join(raiz, para));
    } catch {
      // .gitignore pode não existir; não é motivo para abortar a exportação.
    }
  }
  for (const pasta of ['src', 'web']) {
    cpSync(join(AQUI, pasta), join(raiz, 'codigo', pasta), { recursive: true });
  }
  // O kit de deploy viaja junto: sem ele o pacote roda, mas ninguém sabe
  // publicar o que recebeu.
  try {
    cpSync(join(AQUI, 'deploy'), join(raiz, 'deploy'), { recursive: true });
  } catch { /* pasta ausente numa cópia antiga do projeto */ }

  // ── Dados, instância por instância ──────────────────────────────────────
  // Cada empresa tem o SEU banco, então a exportação tem uma pasta por
  // instância. Juntar tudo num arquivo só desfaria, no pacote, exatamente o
  // isolamento que o sistema mantém em produção.
  const instancias = readdirSync(DIR_INSTANCIAS)
    .filter((f) => f.endsWith('.db'))
    .map((f) => f.replace(/\.db$/, ''));

  const resumo = [];

  for (const inst of instancias) {
    const nome = inst.toUpperCase();
    for (const p of [`dados/${nome}/csv`, `dados/${nome}/json`, `dados/${nome}/banco`]) {
      mkdirSync(join(raiz, p), { recursive: true });
    }

    const db = new DatabaseSync(join(DIR_INSTANCIAS, `${inst}.db`), { readOnly: true });
    const tabelas = db
      .prepare(`select name from sqlite_master
                where type = 'table' and name not like 'sqlite_%' order by name`)
      .all().map((r) => r.name);

    const tudo = {};
    for (const t of tabelas) {
      const linhas = db.prepare(`select * from ${t}`).all().map((l) => ({ ...l }));
      const colunas = db.prepare(`pragma table_info(${t})`).all().map((c) => c.name);

      writeFileSync(join(raiz, `dados/${nome}/csv`, `${t}.csv`), paraCsv(linhas, colunas), 'utf8');
      writeFileSync(
        join(raiz, `dados/${nome}/json`, `${t}.json`),
        `${JSON.stringify(linhas, null, 2)}\n`, 'utf8',
      );
      tudo[t] = linhas;
      resumo.push({ instancia: nome, tabela: t, linhas: linhas.length, colunas: colunas.length });
    }

    writeFileSync(
      join(raiz, `dados/${nome}/json`, '_completo.json'),
      `${JSON.stringify({ instancia: nome, exportadoEm: quando.toISOString(), tabelas: tudo }, null, 2)}\n`,
      'utf8',
    );

    const ddl = db
      .prepare(`select type, name, sql from sqlite_master
                where sql is not null and name not like 'sqlite_%'
                order by case type when 'table' then 0 when 'index' then 1 else 2 end, name`)
      .all().map((r) => `-- ${r.type}: ${r.name}\n${r.sql};`).join('\n\n');
    writeFileSync(join(raiz, `dados/${nome}/banco`, 'schema.sql'), `${ddl}\n`, 'utf8');

    // `VACUUM INTO` e não cópia do arquivo: com WAL ligado o `.db` sozinho pode
    // estar praticamente vazio, e copiar os três arquivos daria certo por
    // acidente até o dia em que não desse.
    const copia = join(raiz, `dados/${nome}/banco`, `${inst}.db`);
    const destinoSql = copia.split('\\').join('/').split("'").join("''");
    db.exec(`vacuum into '${destinoSql}'`);

    const conferencia = new DatabaseSync(copia, { readOnly: true });
    for (const r of resumo.filter((x) => x.instancia === nome)) {
      const n = conferencia.prepare(`select count(*) as n from ${r.tabela}`).get().n;
      if (n !== r.linhas) {
        conferencia.close(); db.close();
        throw new Error(`cópia de ${nome}.${r.tabela} divergiu: ${r.linhas} → ${n}`);
      }
    }
    conferencia.close();
    db.close();
  }

  // ── Manifesto ───────────────────────────────────────────────────────────
  writeFileSync(join(raiz, '00_LEIA-ME.md'), manifesto({ marca, quando, resumo }), 'utf8');

  // ── Inventário e checksums ──────────────────────────────────────────────
  const arquivos = listar(raiz).sort();
  const inventario = arquivos.map((f) => {
    const rel = relative(raiz, f).replaceAll('\\', '/');
    return { caminho: rel, bytes: statSync(f).size, sha256: sha256(f) };
  });

  writeFileSync(
    join(raiz, 'INVENTARIO.csv'),
    paraCsv(inventario, ['caminho', 'bytes', 'sha256']),
    'utf8',
  );
  writeFileSync(
    join(raiz, 'CHECKSUMS_SHA256.txt'),
    `${inventario.map((i) => `${i.sha256}  ${i.caminho}`).join('\n')}\n`,
    'utf8',
  );

  return {
    raiz,
    nome,
    tabelas: resumo,
    instancias: [...new Set(resumo.map((r) => r.instancia))],
    totalLinhas: resumo.reduce((s, r) => s + r.linhas, 0),
    arquivos: inventario.length + 2,
    bytes: inventario.reduce((s, i) => s + i.bytes, 0),
  };
}

function manifesto({ marca, quando, resumo }) {
  const linhaTabela = (r) => `| \`${r.instancia}\` | \`${r.tabela}\` | ${r.linhas} | ${r.colunas} |`;
  const disparos = resumo.find((r) => r.tabela === 'disparos')?.linhas ?? 0;

  // Tabela vazia num pacote chamado "exportação completa" parece falta.
  // Aqui ela é escolha, e o pacote precisa dizer isso sem depender de quem
  // exportou estar por perto para explicar.
  const notaDisparos = disparos === 0
    ? `
> **\`disparos\` está vazia de propósito.** A base foi recarregada antes desta
> exportação, e é assim que ela deve ser entregue: régua cheia, cooldown zerado,
> pronta para demonstrar. Disparar a fila uma vez preenche a tabela e, junto,
> aciona o cooldown que esvazia a régua pelas semanas seguintes — por isso a
> entrega é com a base limpa. Um clique em "Disparar selecionados" popula.
`
    : '';

  const notaRodape = notaDisparos;
  return `# Exportação completa — CRM Multiempresas

**Gerado em:** ${quando.toLocaleString('pt-BR')} (${quando.toISOString()})
**Identificador:** \`${marca}\`
**Origem:** FAT Tech — Figueiredo & Aoki Technology · CNPJ 35.936.589/0001-01

Pacote completo do protótipo: código-fonte, dados e documentação. Foi gerado
pelo próprio sistema, com \`node src/exportar.mjs\`.

---

## Aviso sobre os dados

**Os dados deste pacote são fictícios.** Foram gerados para demonstração
comercial e não representam cliente, veículo, serviço ou pedido real. Nenhum
dado pessoal de terceiro foi utilizado.

As senhas em \`dados/csv/usuarios.csv\` estão em texto claro porque são de
demonstração e não protegem nada. Ao virar produto, viram hash — está na lista
de pendências do README.

---

## O que tem aqui

| Caminho | Conteúdo |
|---|---|
| \`00_LEIA-ME.md\` | Este arquivo |
| \`codigo/\` | Código-fonte completo e executável |
| \`dados/<INSTÂNCIA>/csv/\` | Uma planilha por tabela, com BOM para abrir no Excel |
| \`dados/<INSTÂNCIA>/json/\` | Uma tabela por arquivo, mais \`_completo.json\` |
| \`dados/<INSTÂNCIA>/banco/\` | Banco SQLite da instância, cópia conferida, e o DDL |
| \`documentacao/README.md\` | Manual e roteiro de demonstração de 12 minutos |
| \`documentacao/ROADMAP.md\` | O que faz hoje e as 50 próximas implementações |
| \`deploy/\` | systemd, túnel e runbook para publicar no servidor |
| \`INVENTARIO.csv\` | Caminho, tamanho e SHA-256 de cada arquivo |
| \`CHECKSUMS_SHA256.txt\` | Os mesmos hashes, no formato do \`sha256sum\` |

---

## Conteúdo do banco

| Instância | Tabela | Linhas | Colunas |
|---|---|---:|---:|
${resumo.map(linhaTabela).join('\n')}
${notaRodape}
---

## Rodar a partir deste pacote

Exige Node 22.5 ou superior. Nenhuma dependência a instalar.

\`\`\`bash
cd codigo
node server.mjs
\`\`\`

Abre em <http://127.0.0.1:4501>. Entrar com \`wal@fattech.com.br\` / \`palantyr\`.

O código cria uma base nova e populada se não achar nenhuma. Para continuar
exatamente de onde este pacote parou, aponte para o banco exportado:

\`\`\`bash
FORTCRM_DB=../dados/banco/fortcrm.db node server.mjs
\`\`\`

Verificação, sem subir servidor:

\`\`\`bash
cd codigo && node src/selftest.mjs
\`\`\`

---

## Conferir a integridade

\`\`\`bash
sha256sum -c CHECKSUMS_SHA256.txt
\`\`\`

Diferença de hash indica alteração posterior à exportação.

---

*FAT Tech — Figueiredo & Aoki Technology · CNPJ 35.936.589/0001-01 · Januária, MG*
`;
}

// Execução direta
if (import.meta.url.startsWith('file:')
  && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) {
  const r = exportar();
  console.log('');
  console.log('  EXPORTAÇÃO COMPLETA');
  console.log('  ─────────────────────────────────────────────');
  console.log(`  Pasta      ${r.raiz}`);
  console.log(`  Arquivos   ${r.arquivos}`);
  console.log(`  Instâncias ${r.instancias.join(', ')}`);
  console.log(`  Tabelas    ${r.tabelas.length} · ${r.totalLinhas} linhas`);
  console.log(`  Tamanho    ${(r.bytes / 1024).toFixed(0)} KB`);
  console.log('');
  for (const t of r.tabelas) {
    if (t.linhas > 0) {
      console.log(`    ${t.instancia.padEnd(8)} ${t.tabela.padEnd(20)} ${String(t.linhas).padStart(5)}`);
    }
  }
  console.log('');
}
