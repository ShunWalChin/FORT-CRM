/**
 * Permissão por módulo — o eixo que faltava.
 *
 * O sistema tem uma escala linear: leitura < operador < gestor < soberano. Ela
 * responde "quanto poder", e responde bem para um CRM.
 *
 * Um ERP faz outra pergunta, que não é um degrau da mesma escada: o analista de
 * RH vê salário e não vê o caixa; o do financeiro vê o caixa e não vê salário.
 * Nenhum dos dois é "mais gestor" que o outro. Empilhar isso na escala linear
 * obrigaria a promover o RH a gestor — e junto com a folha ele levaria o
 * financeiro inteiro.
 *
 * Então são dois eixos, e a checagem é uma conjunção: **passa pela escala E
 * tem a concessão do módulo**. Não é "ou". Um soberano sem concessão de RH não
 * vê a folha — e isso é deliberado: o poder de CONCEDER é diferente do poder de
 * VER, e quem administra o sistema não precisa ler o salário de ninguém para
 * administrá-lo.
 *
 * A exceção é `admin`, o módulo que concede os outros. Esse fica preso ao
 * soberano por definição, senão a permissão se autoconcede.
 */

import { agora } from './db.mjs';

export const MODULOS = {
  razao: { nome: 'Razão contábil', descricao: 'Lançamentos, balancete e fechamento.' },
  financeiro: { nome: 'Financeiro', descricao: 'Caixa, bancos e posição consolidada.' },
  contas_pagar: { nome: 'Contas a pagar', descricao: 'Títulos a pagar e baixas.' },
  contas_receber: { nome: 'Contas a receber', descricao: 'Títulos a receber e cobrança.' },
  rh: { nome: 'RH', descricao: 'Colaboradores, cargos e custo de pessoal.' },
  ti: { nome: 'TI', descricao: 'Instâncias, credenciais e saúde do sistema.' },
  comercial: { nome: 'Comercial', descricao: 'Pipeline e resultado de vendas do grupo.' },
  marketing: { nome: 'Marketing', descricao: 'Campanhas, custo por origem e atribuição.' },
  bi: { nome: 'BI', descricao: 'Painéis consolidados de todas as instâncias.' },
  admin: { nome: 'Administração', descricao: 'Conceder e revogar acesso aos módulos.' },
};

/*
 * A ordem dos niveis. `ler` vale ZERO — e zero e falso em JavaScript, o que
 * torna `if (!NIVEIS[nivel])` uma armadilha: ela rejeita justamente o nivel
 * mais comum. Toda checagem daqui compara com `undefined`, nunca por verdade.
 */
export const NIVEIS = { ler: 0, escrever: 1, administrar: 2 };

const nivelConhecido = (n) => NIVEIS[n] !== undefined;

/** Só o soberano administra concessões — senão a permissão se autoconcede. */
export const PAPEL_MINIMO_ERP = 'soberano';

export class ErroDePermissao extends Error {
  constructor(mensagem, detalhe = null) {
    super(mensagem);
    this.codigo = 'sem_permissao';
    this.detalhe = detalhe;
  }
}

/**
 * O que este e-mail pode, por módulo.
 *
 * Devolve mapa, e não lista: a pergunta feita é sempre "pode em X?", e uma
 * lista obrigaria cada chamador a varrer — o que um dia vira varredura dentro
 * de laço.
 */
export function permissoesDe(sql, email) {
  const linhas = sql.prepare(
    'select modulo, nivel from erp_permissoes where usuario_email = ?',
  ).all(String(email ?? '').toLowerCase());
  const mapa = {};
  for (const l of linhas) mapa[l.modulo] = l.nivel;
  return mapa;
}

/**
 * A checagem. Conjunção dos dois eixos, e a recusa diz QUAL deles barrou.
 *
 * "Sem permissão" sozinho manda o operador procurar o administrador sem saber o
 * que pedir. Dizendo o módulo e o nível, ele pede a coisa certa na primeira vez.
 */
export function exigir(sql, { email, papel, modulo, nivel = 'ler' }) {
  if (!MODULOS[modulo]) throw new ErroDePermissao(`Módulo desconhecido: ${modulo}`);
  if (!nivelConhecido(nivel)) throw new ErroDePermissao(`Nível desconhecido: ${nivel}`);

  // Eixo 1: a escala. O ERP inteiro é território de direção.
  if (papel !== 'soberano' && papel !== 'gestor') {
    throw new ErroDePermissao(
      'O ERP do grupo é restrito à direção. Fale com quem administra o sistema.',
      { exigido: 'gestor', papel },
    );
  }

  // O módulo que concede os outros fica preso ao topo da escala.
  if (modulo === 'admin' && papel !== 'soberano') {
    throw new ErroDePermissao(
      'Conceder acesso a módulo é atribuição do soberano.',
      { exigido: 'soberano', papel },
    );
  }

  // Eixo 2: a concessão. Vale inclusive para o soberano — ver e administrar
  // são poderes diferentes, e o registro de quem podia ver o quê é o que
  // sustenta a resposta na auditoria.
  const tem = permissoesDe(sql, email)[modulo];
  if (!tem) {
    throw new ErroDePermissao(
      `Sem acesso ao módulo ${MODULOS[modulo].nome}.`,
      { modulo, exigido: nivel, tem: null },
    );
  }
  if (NIVEIS[tem] < NIVEIS[nivel]) {
    throw new ErroDePermissao(
      `Acesso de "${tem}" em ${MODULOS[modulo].nome} não permite ${nivel}.`,
      { modulo, exigido: nivel, tem },
    );
  }
  return { modulo, nivel: tem };
}

export function conceder(sql, { email, modulo, nivel = 'ler', por }) {
  if (!MODULOS[modulo]) throw new ErroDePermissao(`Módulo desconhecido: ${modulo}`);
  if (!nivelConhecido(nivel)) throw new ErroDePermissao(`Nível desconhecido: ${nivel}`);
  const alvo = String(email ?? '').toLowerCase();
  if (!alvo.includes('@')) throw new ErroDePermissao('Informe o e-mail de quem recebe.');

  sql.prepare(
    `insert into erp_permissoes (usuario_email, modulo, nivel, concedido_por, concedido_em)
     values (?,?,?,?,?)
     on conflict(usuario_email, modulo) do update set
       nivel = excluded.nivel, concedido_por = excluded.concedido_por,
       concedido_em = excluded.concedido_em`,
  ).run(alvo, modulo, nivel, por, agora());

  return { email: alvo, modulo, nivel, por };
}

export function revogar(sql, { email, modulo }) {
  const alvo = String(email ?? '').toLowerCase();
  const r = sql.prepare('delete from erp_permissoes where usuario_email = ? and modulo = ?')
    .run(alvo, modulo);
  return { email: alvo, modulo, revogou: r.changes > 0 };
}

/**
 * Semeia TODOS os soberanos com acesso a tudo, na primeira subida.
 *
 * Sem isto o ERP nasce trancado para todos, inclusive para quem poderia
 * destrancá-lo — e a saída seria editar o banco à mão, que é exatamente o que
 * um sistema de permissão existe para tornar desnecessário.
 *
 * **Todos, e não o primeiro que entrar.** A primeira versão semeava só quem
 * abrisse a tela primeiro, porque recebia um e-mail só. O efeito em produção
 * foi um sistema com dois soberanos onde apenas um enxergava o ERP — e o outro
 * batia num "sem acesso ao módulo" que não explicava nada, porque ele *era* o
 * dono do sistema.
 *
 * A condição de guarda continua sendo a tabela VAZIA. É o que separa semeadura
 * de regra: se alguém revogar um módulo de um soberano, o próximo login não
 * desfaz a revogação. Semear é o que acontece uma vez, no começo; depois disso,
 * quem concede é gente.
 */
export function semearAcesso(sql, emails) {
  const alvos = [...new Set(
    (Array.isArray(emails) ? emails : [emails])
      .map((e) => String(e ?? '').toLowerCase())
      .filter((e) => e.includes('@')),
  )];
  if (!alvos.length) return { criadas: [] };

  if (sql.prepare('select count(*) as n from erp_permissoes').get().n > 0) {
    return { criadas: [], motivo: 'ja_existe_concessao' };
  }

  const criadas = [];
  for (const alvo of alvos) {
    for (const modulo of Object.keys(MODULOS)) {
      conceder(sql, { email: alvo, modulo, nivel: 'administrar', por: 'sistema' });
      criadas.push(`${alvo}:${modulo}`);
    }
  }
  return { criadas, emails: alvos };
}

/** Quem tem o quê — a tela de administração de acesso. */
export function mapaDeAcesso(sql) {
  const linhas = sql.prepare(
    'select usuario_email, modulo, nivel, concedido_por, concedido_em from erp_permissoes order by usuario_email, modulo',
  ).all();
  const porPessoa = {};
  for (const l of linhas) {
    (porPessoa[l.usuario_email] ??= {})[l.modulo] = {
      nivel: l.nivel, por: l.concedido_por, em: l.concedido_em,
    };
  }
  return { porPessoa, modulos: MODULOS, niveis: Object.keys(NIVEIS) };
}
