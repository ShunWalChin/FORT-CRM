/**
 * Senha: derivação, verificação e migração.
 *
 * Até aqui a senha vivia em texto claro no banco. Era defensável enquanto o
 * sistema rodava em `127.0.0.1` com dado fictício e endereço efêmero. Deixa de
 * ser no instante em que ele ganha endereço permanente num servidor — que é
 * exatamente o que está sendo feito agora. Era o risco nº 1 do laudo, e
 * hospedar sem resolvê-lo seria escolher o risco de propósito.
 *
 * `scrypt` do `node:crypto`, não SHA-256 nem bcrypt de terceiro:
 *
 *   SHA-256 é rápido, e rapidez é justamente o defeito num verificador de
 *   senha — uma GPU testa bilhões por segundo. `scrypt` é deliberadamente
 *   lento E custoso em memória, o que tira a vantagem do hardware paralelo.
 *
 *   bcrypt exigiria dependência nativa, compilada por arquitetura. O servidor
 *   é aarch64 e a máquina de quem desenvolve é x86 — é o tipo de coisa que
 *   funciona no notebook e falha no deploy. `scrypt` vem no Node.
 *
 * Formato guardado: `scrypt$N$r$p$<sal em base64>$<derivado em base64>`.
 * Os parâmetros ficam DENTRO do registro, e não numa constante do código,
 * porque endurecer o custo no futuro não pode invalidar as senhas já gravadas.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Custo. `N=16384` leva ~50 ms nesta classe de máquina — caro o bastante para
 * atrapalhar força bruta, barato o bastante para não travar um login.
 * `maxmem` precisa ser declarado: o padrão do Node (32 MB) é MENOR que
 * `128*N*r`, e o `scrypt` falha com "Invalid scrypt params" em vez de rodar
 * mais devagar. É o tipo de erro que só aparece quando alguém aumenta o N.
 */
const N = 16384;
const R = 8;
const P = 1;
const TAM_SAL = 16;
const TAM_CHAVE = 32;
const MAXMEM = 256 * 1024 * 1024;

const PREFIXO = 'scrypt$';

export function ehHash(guardado) {
  return typeof guardado === 'string' && guardado.startsWith(PREFIXO);
}

export function hashSenha(senha, { n = N, r = R, p = P } = {}) {
  const texto = String(senha ?? '');
  if (!texto) throw new Error('senha vazia');

  const sal = randomBytes(TAM_SAL);
  const derivado = scryptSync(texto, sal, TAM_CHAVE, { N: n, r, p, maxmem: MAXMEM });

  return [
    'scrypt', n, r, p,
    sal.toString('base64'),
    derivado.toString('base64'),
  ].join('$');
}

/**
 * Compara em tempo constante.
 *
 * Um `===` aqui vaza, pelo tempo de resposta, quantos bytes do começo bateram —
 * e isso basta para descobrir o hash byte a byte. O comprimento é conferido
 * antes porque `timingSafeEqual` lança se os buffers diferirem em tamanho, e
 * uma exceção também é um canal.
 */
export function verificarSenha(senha, guardado) {
  if (!ehHash(guardado)) return false;

  const partes = String(guardado).split('$');
  if (partes.length !== 6) return false;

  const [, n, r, p, salB64, chaveB64] = partes;
  const sal = Buffer.from(salB64, 'base64');
  const esperado = Buffer.from(chaveB64, 'base64');
  if (!sal.length || !esperado.length) return false;

  let calculado;
  try {
    calculado = scryptSync(String(senha ?? ''), sal, esperado.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM,
    });
  } catch {
    return false;
  }

  if (calculado.length !== esperado.length) return false;
  return timingSafeEqual(calculado, esperado);
}

/**
 * Converte para hash toda senha ainda em texto claro.
 *
 * Roda na subida do servidor, não no primeiro login de cada um. A diferença
 * importa: migrar no login deixaria em texto claro, por tempo indefinido, a
 * senha de quem não entrasse — e são justamente as contas esquecidas que
 * ninguém audita.
 *
 * @returns {{migradas:number, jaEmHash:number}}
 */
export function migrarSenhas(banco) {
  const sql = banco.sistema();
  let usuarios;
  try {
    usuarios = sql.prepare('select id, senha from usuarios').all();
  } catch {
    return { migradas: 0, jaEmHash: 0 };
  }

  let migradas = 0;
  let jaEmHash = 0;

  for (const u of usuarios) {
    if (ehHash(u.senha)) { jaEmHash += 1; continue; }
    sql.prepare('update usuarios set senha = ? where id = ?').run(hashSenha(u.senha), u.id);
    migradas += 1;
  }

  return { migradas, jaEmHash };
}

/**
 * Política mínima. Não é a do banco central — é o piso que impede a senha de
 * uma linha só e a repetição do e-mail.
 */
export function avaliarForca(senha, { email = '' } = {}) {
  const s = String(senha ?? '');
  const problemas = [];

  if (s.length < 8) problemas.push('precisa de ao menos 8 caracteres');
  if (!/[a-zA-Z]/.test(s)) problemas.push('precisa de ao menos uma letra');
  if (!/[0-9\W]/.test(s)) problemas.push('precisa de ao menos um número ou símbolo');

  const usuario = String(email).split('@')[0].toLowerCase();
  if (usuario.length >= 4 && s.toLowerCase().includes(usuario)) {
    problemas.push('não pode conter o próprio e-mail');
  }

  return { aceitavel: problemas.length === 0, problemas };
}
