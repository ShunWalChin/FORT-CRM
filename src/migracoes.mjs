/**
 * Migrações de coluna.
 *
 * O schema é aplicado com `create table if not exists`, o que resolve o banco
 * novo e NÃO resolve o banco que já existe: acrescentar uma coluna ao arquivo
 * `schema.mjs` não faz nada numa base já criada. A tabela continua como estava,
 * e a primeira escrita quebra com "table X has no column named Y".
 *
 * Aconteceu em produção com `clientes.campos`: local funcionava, porque eu
 * apagava `data/` e a base nascia com o schema novo. No servidor, onde apagar a
 * base não é opção, o deploy subiu e a recarga quebrou.
 *
 * Aqui não há framework de migração e nem deve haver: são acréscimos de coluna,
 * declarados, aplicados na subida e idempotentes. O que este arquivo NÃO faz —
 * de propósito — é remover coluna, renomear ou mudar tipo. Isso exige recriar a
 * tabela, e uma operação dessas tem de ser escrita e revisada uma a uma, não
 * inferida por diferença.
 */

/**
 * Colunas que precisam existir. Acrescentar aqui é o passo obrigatório ao
 * acrescentar coluna no `schema.mjs` — as duas listas andam juntas.
 *
 * A definição vai crua para o `ALTER TABLE`. SQLite exige que coluna nova com
 * `not null` tenha `default`, senão as linhas existentes ficariam inválidas.
 */
export const COLUNAS_ESPERADAS = [
  { tabela: 'clientes', coluna: 'campos', definicao: "text not null default '{}'" },

  // Click-to-WhatsApp: o clique que abre a conversa.
  { tabela: 'atribuicoes', coluna: 'ctwa_clid', definicao: 'text' },
  { tabela: 'atribuicoes', coluna: 'waba_id', definicao: 'text' },
  { tabela: 'atribuicoes', coluna: 'source_ad_id', definicao: 'text' },
  { tabela: 'atribuicoes', coluna: 'ctwa_clid_ausente', definicao: 'integer not null default 0' },

  // As duas formas do telefone: Google pede E.164 com '+', Meta pede dígitos.
  { tabela: 'identificadores_hash', coluna: 'fone_digitos_sha256', definicao: 'text' },

  // Diagnóstico de envio da conversão.
  { tabela: 'conversoes', coluna: 'action_source', definicao: 'text' },
  { tabela: 'conversoes', coluna: 'tentativas', definicao: 'integer not null default 0' },
  { tabela: 'conversoes', coluna: 'http_status', definicao: 'integer' },
  { tabela: 'conversoes', coluna: 'fbtrace_id', definicao: 'text' },
  { tabela: 'conversoes', coluna: 'proxima_tentativa_em', definicao: 'text' },

  // Referencia do pedido/contrato/OS da venda ganha.
  { tabela: 'oportunidades', coluna: 'pedido_ref', definicao: 'text' },

  // Oficina: identificacao do cliente e do veiculo.
  { tabela: 'clientes', coluna: 'cpf', definicao: 'text' },
  { tabela: 'veiculos', coluna: 'chassi', definicao: 'text' },
  { tabela: 'veiculos', coluna: 'renavam', definicao: 'text' },
  { tabela: 'veiculos', coluna: 'cor', definicao: 'text' },
  { tabela: 'veiculos', coluna: 'combustivel', definicao: "text not null default 'diesel_s10'" },
  { tabela: 'veiculos', coluna: 'apelido', definicao: 'text' },
  { tabela: 'veiculos', coluna: 'observacao', definicao: 'text' },
  { tabela: 'veiculos', coluna: 'ativo', definicao: 'integer not null default 1' },

  // A vistoria trava o inicio da OS.
  { tabela: 'ordens_servico', coluna: 'vistoria_id', definicao: 'text' },

  // Profundidade da revisao na vistoria.
  { tabela: 'vistorias', coluna: 'nivel', definicao: "text not null default 'prata'" },
];

/**
 * Aplica o que falta. Devolve o que foi feito, para o log da subida dizer.
 *
 * Tabela ausente é ignorada em silêncio: a central e as instâncias de empresa
 * têm schemas diferentes, e exigir que toda tabela exista em toda base faria a
 * migração falhar por desenho, não por defeito.
 */
export function migrarColunas(sql) {
  const feitas = [];

  for (const { tabela, coluna, definicao } of COLUNAS_ESPERADAS) {
    let colunas;
    try {
      colunas = sql.prepare(`pragma table_info(${tabela})`).all();
    } catch {
      continue;
    }
    if (!colunas.length) continue;
    if (colunas.some((c) => c.name === coluna)) continue;

    try {
      sql.exec(`alter table ${tabela} add column ${coluna} ${definicao}`);
      feitas.push(`${tabela}.${coluna}`);
    } catch (e) {
      // Falhar alto: uma coluna que não entrou é uma escrita que vai quebrar
      // depois, longe daqui, com uma mensagem que não explica nada.
      throw new Error(`migração falhou em ${tabela}.${coluna}: ${e.message}`);
    }
  }

  return feitas;
}
