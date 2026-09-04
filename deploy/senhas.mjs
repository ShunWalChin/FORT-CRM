/**
 * Define uma senha distinta por conta, em todas as instâncias onde o e-mail
 * existe. Roda DENTRO do contêiner, e as senhas são geradas aqui — nunca
 * passam pelo repositório nem pelo disco de quem executa.
 *
 * Uma senha por conta, e não uma para todas: no registro de auditoria dá para
 * saber quem fez o quê, e revogar um testador não derruba os outros.
 */
import { randomBytes } from 'node:crypto';
import { Federacao, CATALOGO } from '../src/federacao.mjs';
import { hashSenha } from '../src/senha.mjs';

const fed = new Federacao(process.env.FORTCRM_DIR ?? '/dados/instancias');

/** Legível em voz alta e forte o bastante: 4 blocos de 4, sem caractere ambíguo. */
function gerar() {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(16);
  const bloco = (i) => [...bytes.slice(i * 4, i * 4 + 4)]
    .map((b) => alfabeto[b % alfabeto.length]).join('');
  return `${bloco(0)}-${bloco(1)}-${bloco(2)}-${bloco(3)}`;
}

const contas = new Map();

for (const e of CATALOGO) {
  const banco = fed.abrir(e.codigo);
  const sql = banco.sistema();
  for (const u of sql.prepare('select id, nome, email, papel from usuarios').all()) {
    const chave = u.email.toLowerCase();
    if (!contas.has(chave)) {
      contas.set(chave, { nome: u.nome, email: u.email, papel: u.papel, senha: gerar(), onde: [] });
    }
    const c = contas.get(chave);
    c.onde.push(e.codigo);
    sql.prepare('update usuarios set senha = ? where id = ?').run(hashSenha(c.senha), u.id);
  }
}

console.log(JSON.stringify([...contas.values()], null, 1));
fed.fecharTudo();
