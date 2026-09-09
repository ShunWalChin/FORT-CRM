/**
 * Define uma senha distinta por conta, em todas as instâncias onde o e-mail
 * existe. Roda DENTRO do contêiner.
 *
 * Uma senha por conta, e não uma para todas: no registro de auditoria dá para
 * saber quem fez o quê, e revogar um testador não derruba os outros.
 *
 * ═══ Dois modos ═══
 *
 *   `node deploy/senhas.mjs`            gera senhas novas e imprime o mapa.
 *   `node deploy/senhas.mjs --definir`  lê `{email: senha}` de STDIN e aplica.
 *
 * O segundo existe porque a recarga da demonstração reseta tudo para a senha
 * inicial, e restaurar um conjunto conhecido à mão significaria editar o banco
 * — que é justamente o que uma ferramenta de senha existe para tornar
 * desnecessário.
 *
 * ═══ Por que STDIN, e não argumento ═══
 *
 * Senha em `argv` aparece na lista de processos do servidor e no histórico do
 * shell de quem executou. Por STDIN ela não toca disco nem fica em lugar
 * nenhum depois que o processo termina.
 *
 * ═══ A política vale aqui também ═══
 *
 * Toda senha definida passa por `avaliarForca`, a mesma checagem da troca pela
 * tela. Uma ferramenta administrativa que aceita o que a tela recusa é uma
 * porta dos fundos na política — e o dia em que alguém usar esta para pôr
 * "123456" numa conta de produção, a política terá deixado de existir sem que
 * ninguém a tenha removido.
 */
import { randomBytes } from 'node:crypto';
import { Federacao, CATALOGO } from '../src/federacao.mjs';
import { avaliarForca, hashSenha } from '../src/senha.mjs';

const fed = new Federacao(process.env.FORTCRM_DIR ?? '/dados/instancias');

/** Legível em voz alta e forte o bastante: 4 blocos de 4, sem caractere ambíguo. */
function gerar() {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(16);
  const bloco = (i) => [...bytes.slice(i * 4, i * 4 + 4)]
    .map((b) => alfabeto[b % alfabeto.length]).join('');
  return `${bloco(0)}-${bloco(1)}-${bloco(2)}-${bloco(3)}`;
}

const definir = process.argv.includes('--definir');

/** Lê o mapa `{email: senha}` de STDIN. Só no modo `--definir`. */
async function lerMapa() {
  const bruto = await new Promise((r) => {
    let t = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { t += c; });
    process.stdin.on('end', () => r(t));
  });
  const m = JSON.parse(bruto);
  const fora = [];
  for (const [email, senha] of Object.entries(m)) {
    const f = avaliarForca(senha, { email });
    if (!f.aceitavel) fora.push(`${email}: ${f.problemas.join('; ')}`);
  }
  if (fora.length) {
    console.error('Senha recusada pela política do sistema:');
    for (const x of fora) console.error(`  ${x}`);
    process.exit(1);
  }
  // Normaliza a chave: o banco guarda o e-mail como veio, e a busca é por
  // minúscula em todo o resto do sistema.
  return new Map(Object.entries(m).map(([e, v]) => [e.toLowerCase(), v]));
}

const pedidas = definir ? await lerMapa() : null;

const contas = new Map();
const naoEncontradas = new Set(pedidas ? pedidas.keys() : []);

for (const e of CATALOGO) {
  const banco = fed.abrir(e.codigo);
  const sql = banco.sistema();
  for (const u of sql.prepare('select id, nome, email, papel from usuarios').all()) {
    const chave = u.email.toLowerCase();

    // No modo `--definir`, conta fora do mapa NÃO é tocada. Trocar a senha de
    // quem não foi citado seria efeito colateral silencioso na produção.
    if (pedidas && !pedidas.has(chave)) continue;
    naoEncontradas.delete(chave);

    if (!contas.has(chave)) {
      contas.set(chave, {
        nome: u.nome,
        email: u.email,
        papel: u.papel,
        senha: pedidas ? pedidas.get(chave) : gerar(),
        onde: [],
      });
    }
    const c = contas.get(chave);
    c.onde.push(e.codigo);
    sql.prepare('update usuarios set senha = ? where id = ?').run(hashSenha(c.senha), u.id);
  }
}

if (naoEncontradas.size) {
  // Falha alto: pedir para definir a senha de uma conta que não existe quase
  // sempre é e-mail digitado errado, e devolver sucesso esconderia isso até
  // alguém tentar entrar.
  console.error(`Conta(s) não encontrada(s): ${[...naoEncontradas].join(', ')}`);
  fed.fecharTudo();
  process.exit(1);
}

// No modo `--definir` a senha já é conhecida de quem chamou; imprimir de novo
// só a espalharia por mais um log. Sai o que foi tocado, e onde.
console.log(JSON.stringify(
  [...contas.values()].map((c) => (definir
    ? { email: c.email, papel: c.papel, onde: c.onde }
    : c)),
  null,
  1,
));
fed.fecharTudo();
