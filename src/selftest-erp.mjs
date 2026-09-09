/**
 * Testes do ERP — as invariantes que o razão não pode perder.
 *
 * Um sistema contábil não se prova por "funcionou quando eu tentei". Prova-se
 * mostrando que ele RECUSA o que não pode aceitar, e que o livro continua
 * batendo depois de cada operação. Cada teste aqui é uma das seis invariantes
 * declaradas em `erp-schema.mjs`, ou a prova de que uma delas resiste a uma
 * tentativa concreta de furá-la.
 */

import { rmSync } from 'node:fs';
import { Federacao } from './federacao.mjs';
import {
  ErroDeDinheiro, centavos, formatar, paraCentavos, percentual, ratear, somar,
} from './dinheiro.mjs';
import {
  ErroContabil, GRUPO, balancete, competenciaDe, conferir, estornar, fechar,
  garantirPeriodo, lancar, ratearEntreEmpresas, reabrir, saldos, semearPlano,
} from './razao.mjs';
import {
  abrir as abrirTitulo, baixar, cancelar, carteira, posicao,
} from './titulos.mjs';
import {
  ErroDePermissao, MODULOS, conceder, exigir, mapaDeAcesso, permissoesDe, revogar, semearAcesso,
} from './permissoes.mjs';

let passou = 0;
const falhas = [];

function teste(nome, fn) {
  try {
    fn();
    passou += 1;
    console.log(`  ok   ${nome}`);
  } catch (e) {
    falhas.push({ nome, erro: e.message });
    console.log(`  FALHA ${nome}\n         ${e.message}`);
  }
}
const igual = (a, b, m) => {
  if (a !== b) throw new Error(`${m ?? 'diferente'} — esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};
const verdadeiro = (v, m) => { if (!v) throw new Error(m ?? 'esperava verdadeiro'); };

/** Roda e devolve o erro. Um teste de recusa que não recusa é uma falha. */
function recusa(fn) {
  try { fn(); } catch (e) { return e; }
  throw new Error('esperava recusa, e a chamada passou');
}

const DIR = new URL('../data/teste-erp/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
rmSync(DIR, { recursive: true, force: true });
const fed = new Federacao(DIR);
const central = fed.abrirCentral();
const sql = central.sistema();
semearPlano(sql);

const ATOR = 'root@fortgrupo.com.br';
const CAIXA = '1.1.01.001';
const BANCO = '1.1.01.002';
const RECEITA = '4.1.01.002';
const DESPESA = '5.2.01.006';
const ALUGUEL = '5.2.01.002';
const FORNECEDOR = '2.1.01.001';
const CLIENTES = '1.1.02.001';

console.log('\n DINHEIRO\n');

teste('centavo não se divide, e o que não é inteiro é recusado', () => {
  igual(centavos(165000), 165000);
  igual(recusa(() => centavos(1050.5)).constructor, ErroDeDinheiro);
  igual(recusa(() => centavos('1050')).constructor, ErroDeDinheiro, 'texto não é centavo');
  igual(recusa(() => centavos(NaN)).constructor, ErroDeDinheiro);
  igual(recusa(() => centavos(Number.MAX_SAFE_INTEGER + 10)).constructor, ErroDeDinheiro);
});

teste('o teclado brasileiro: ponto de milhar não é ponto decimal', () => {
  /*
   * Esta é a conversão que já quebrou o campo de valor da vistoria neste
   * sistema. "1.650" tem de virar mil e seiscentos e cinquenta reais, e "1.65"
   * tem de virar um real e sessenta e cinco — errar aqui erra por mil vezes.
   */
  igual(paraCentavos('1.650,00'), 165000);
  igual(paraCentavos('1650,00'), 165000);
  igual(paraCentavos('1.650'), 165000, 'ponto separando três dígitos é milhar');
  igual(paraCentavos('1.65'), 165, 'ponto sem três dígitos é decimal');
  igual(paraCentavos('1650.00'), 165000);
  igual(paraCentavos('R$ 1.234.567,89'), 123456789);
  igual(paraCentavos('-45,90'), -4590);
  igual(paraCentavos('(45,90)'), -4590, 'parêntese é negativo na contabilidade');
  igual(paraCentavos(''), null);
  igual(paraCentavos(null), null);
  igual(recusa(() => paraCentavos('1,999')).constructor, ErroDeDinheiro, 'três casas não é centavo');
  igual(recusa(() => paraCentavos('abc')).constructor, ErroDeDinheiro);
});

teste('ida e volta do valor não perde nada', () => {
  for (const t of ['0,01', '1.650,00', '999.999,99', '1.234.567,89']) {
    igual(formatar(paraCentavos(t)), t, `${t} não sobreviveu à ida e volta`);
  }
  igual(formatar(-4590), '-45,90');
  igual(formatar(165000, { moeda: true }), 'R$ 1.650,00');
});

teste('rateio não perde nem inventa centavo', () => {
  /*
   * R$ 100,00 em três não dá 33,33 três vezes: dá 33,34 + 33,33 + 33,33. O
   * centavo que sobra do arredondamento vai para quem tem o maior resto, e a
   * soma das partes é SEMPRE igual ao todo — é o que impede o rateio de um
   * custo de virar diferença no fechamento.
   */
  const tres = ratear(10000, [1, 1, 1]);
  igual(somar(tres), 10000, 'a soma das partes tem de ser o todo');
  igual(tres.join(','), '3334,3333,3333');

  const desigual = ratear(10000, [70, 20, 10]);
  igual(somar(desigual), 10000);
  igual(desigual.join(','), '7000,2000,1000');

  // O caso perverso: um centavo entre três.
  const um = ratear(1, [1, 1, 1]);
  igual(somar(um), 1, 'um centavo entre três continua sendo um centavo');

  // Negativo (um estorno rateado) também fecha.
  igual(somar(ratear(-10000, [1, 1, 1])), -10000);

  igual(recusa(() => ratear(100, [0, 0])).constructor, ErroDeDinheiro, 'peso zero é divisão por zero');

  // Reprodutível: duas chamadas iguais, saída idêntica.
  igual(ratear(10000, [1, 1, 1]).join(), ratear(10000, [1, 1, 1]).join());
});

teste('percentual arredonda ao centavo', () => {
  igual(percentual(100000, 7.5), 7500);
  igual(percentual(333, 33.33), 111);
});

console.log('\n RAZÃO: AS SEIS INVARIANTES\n');

teste('1. lançamento que não soma zero é RECUSADO, com a diferença no texto', () => {
  const e = recusa(() => lancar(sql, {
    instancia: 'MP', data: '2026-03-10', historico: 'Torto de propósito', ator: ATOR,
    partidas: [
      { conta: DESPESA, tipo: 'D', valor_centavos: 10000 },
      { conta: CAIXA, tipo: 'C', valor_centavos: 9900 },
    ],
  }));
  igual(e.codigo, 'nao_fecha');
  verdadeiro(/1,00/.test(e.message), `a mensagem precisa dizer a diferença: ${e.message}`);
  igual(e.detalhe.diferenca, 100);

  // E nada foi gravado: recusar tem de ser recusar, não gravar metade.
  igual(sql.prepare("select count(*) n from erp_lancamentos where historico = 'Torto de propósito'").get().n, 0);
});

teste('1b. partida dobrada exige as duas pernas', () => {
  igual(recusa(() => lancar(sql, {
    instancia: 'MP', data: '2026-03-10', historico: 'Perna só', ator: ATOR,
    partidas: [{ conta: DESPESA, tipo: 'D', valor_centavos: 100 }],
  })).codigo, 'partida_dobrada');
});

teste('1c. o valor é sempre positivo — quem dá o sinal é o tipo', () => {
  /*
   * Permitir débito negativo criaria duas formas de escrever o mesmo fato, e é
   * assim que um livro deixa de bater consigo mesmo: metade dos relatórios
   * somaria por tipo, a outra metade por sinal.
   */
  igual(recusa(() => lancar(sql, {
    instancia: 'MP', data: '2026-03-10', historico: 'Negativo', ator: ATOR,
    partidas: [
      { conta: DESPESA, tipo: 'D', valor_centavos: -100 },
      { conta: CAIXA, tipo: 'C', valor_centavos: -100 },
    ],
  })).codigo, 'valor_invalido');
});

teste('4. conta sintética não recebe lançamento', () => {
  const e = recusa(() => lancar(sql, {
    instancia: 'MP', data: '2026-03-10', historico: 'Na sintética', ator: ATOR,
    partidas: [
      { conta: '5.2', tipo: 'D', valor_centavos: 100 },
      { conta: CAIXA, tipo: 'C', valor_centavos: 100 },
    ],
  }));
  igual(e.codigo, 'conta_sintetica');
  igual(recusa(() => lancar(sql, {
    instancia: 'MP', data: '2026-03-10', historico: 'Conta que não existe', ator: ATOR,
    partidas: [
      { conta: '9.9.99.999', tipo: 'D', valor_centavos: 100 },
      { conta: CAIXA, tipo: 'C', valor_centavos: 100 },
    ],
  })).codigo, 'conta_inexistente');
});

teste('todo lançamento precisa de histórico', () => {
  // É o que explica o valor seis meses depois, para quem não estava lá.
  igual(recusa(() => lancar(sql, {
    instancia: 'MP', data: '2026-03-10', historico: '  ', ator: ATOR,
    partidas: [
      { conta: DESPESA, tipo: 'D', valor_centavos: 100 },
      { conta: CAIXA, tipo: 'C', valor_centavos: 100 },
    ],
  })).codigo, 'historico_ausente');
});

teste('o lançamento válido grava, e o balancete fecha', () => {
  const r = lancar(sql, {
    instancia: 'MP', data: '2026-03-15', historico: 'Serviço de oficina à vista', ator: ATOR,
    partidas: [
      { conta: CAIXA, tipo: 'D', valor_centavos: 89000 },
      { conta: RECEITA, tipo: 'C', valor_centavos: 89000 },
    ],
  });
  verdadeiro(r.id);
  igual(r.competencia, '2026-03', 'a competência é o mês do fato');
  igual(r.total, 89000);

  const b = balancete(sql, { competencia: '2026-03' });
  igual(b.confere, true, 'o livro tem de fechar');
  igual(b.debito, b.credito);
  igual(b.receita, 89000);
});

teste('3. lançamento não se edita — estorna-se, e os dois ficam', () => {
  const orig = lancar(sql, {
    instancia: 'AF', data: '2026-03-20', historico: 'Venda lançada errado', ator: ATOR,
    partidas: [
      { conta: CAIXA, tipo: 'D', valor_centavos: 50000 },
      { conta: RECEITA, tipo: 'C', valor_centavos: 50000 },
    ],
  });
  const est = estornar(sql, { lancamentoId: orig.id, data: '2026-03-21', motivo: 'valor trocado', ator: ATOR });

  const o = sql.prepare('select * from erp_lancamentos where id = ?').get(orig.id);
  const e = sql.prepare('select * from erp_lancamentos where id = ?').get(est.id);
  igual(o.estornado_por, est.id, 'o original aponta para o estorno');
  igual(e.estorna, orig.id, 'o estorno aponta para o original');
  igual(o.historico, 'Venda lançada errado', 'o original NÃO muda');

  // As pernas vêm trocadas.
  const po = sql.prepare("select tipo, conta from erp_partidas where lancamento_id = ? and conta = ?").get(orig.id, CAIXA);
  const pe = sql.prepare("select tipo, conta from erp_partidas where lancamento_id = ? and conta = ?").get(est.id, CAIXA);
  igual(po.tipo, 'D');
  igual(pe.tipo, 'C', 'o estorno espelha as pernas');

  // O par soma zero: a conta volta ao que era.
  const s = saldos(sql, { instancia: 'AF' }).find((x) => x.conta === RECEITA);
  igual(s?.saldo ?? 0, 0, 'original mais estorno tem de zerar a conta');

  igual(recusa(() => estornar(sql, { lancamentoId: orig.id, ator: ATOR })).codigo, 'ja_estornado');
  igual(recusa(() => estornar(sql, { lancamentoId: est.id, ator: ATOR })).codigo, 'estorno_de_estorno');
});

teste('2. período fechado não recebe lançamento', () => {
  garantirPeriodo(sql, '2026-01');
  garantirPeriodo(sql, '2026-02');
  lancar(sql, {
    instancia: 'MP', data: '2026-01-10', historico: 'Aluguel de janeiro', ator: ATOR,
    partidas: [
      { conta: ALUGUEL, tipo: 'D', valor_centavos: 250000 },
      { conta: BANCO, tipo: 'C', valor_centavos: 250000 },
    ],
  });

  const f = fechar(sql, { competencia: '2026-01', ator: ATOR });
  igual(f.confere, true);
  igual(f.despesa, 250000);

  const e = recusa(() => lancar(sql, {
    instancia: 'MP', data: '2026-01-20', historico: 'Atrasado', ator: ATOR,
    partidas: [
      { conta: ALUGUEL, tipo: 'D', valor_centavos: 100 },
      { conta: BANCO, tipo: 'C', valor_centavos: 100 },
    ],
  }));
  igual(e.codigo, 'periodo_fechado');
  verdadeiro(/período aberto seguinte/i.test(e.message), 'a recusa precisa dizer o que fazer');
});

teste('não se fecha na desordem, e o motivo é dito', () => {
  const e = recusa(() => fechar(sql, { competencia: '2026-03', ator: ATOR }));
  igual(e.codigo, 'anterior_aberto');
  igual(e.detalhe.pendente, '2026-02', 'tem de dizer QUAL mês está aberto');
  igual(recusa(() => fechar(sql, { competencia: '2026-01', ator: ATOR })).codigo, 'ja_fechado');
});

teste('reabrir período exige motivo — é o que a auditoria vai ler', () => {
  igual(recusa(() => reabrir(sql, { competencia: '2026-01', ator: ATOR, motivo: 'x' })).codigo,
    'motivo_obrigatorio');
  const r = reabrir(sql, { competencia: '2026-01', ator: ATOR, motivo: 'lançamento de aluguel esquecido' });
  igual(r.competencia, '2026-01');
  igual(sql.prepare("select status from erp_periodos where competencia='2026-01'").get().status, 'aberto');
});

console.log('\n CONTAS A PAGAR E A RECEBER\n');

let tituloId = null;

teste('6. título nasce com o seu lançamento — os dois, ou nenhum', () => {
  const t = abrirTitulo(central, {
    instancia: 'MP', natureza: 'pagar', descricao: 'Contador de março',
    emissao: '2026-03-01', vencimento: '2026-03-10', valor: 120000,
    conta: DESPESA, ator: ATOR,
  });
  tituloId = t.id;
  igual(t.saldo, 120000);

  const l = sql.prepare('select * from erp_lancamentos where id = ?').get(t.lancamentoId);
  verdadeiro(l, 'o título tem de ter gerado lançamento');
  igual(l.origem, 'titulo');
  igual(l.origem_ref, t.id, 'o lançamento aponta de volta para o título');

  // A obrigação existe no passivo.
  const forn = saldos(sql, { instancia: 'MP' }).find((x) => x.conta === FORNECEDOR);
  igual(forn.saldo, 120000, 'a dívida com fornecedor tem de aparecer no passivo');
});

teste('5. título não se baixa além do saldo, e a recusa diz o saldo', () => {
  const e = recusa(() => baixar(central, {
    tituloId, data: '2026-03-10', valor: 150000, meio: 'pix', ator: ATOR,
  }));
  igual(e.codigo, 'acima_do_saldo');
  verdadeiro(/1\.200,00/.test(e.message), `a recusa precisa dizer o saldo: ${e.message}`);

  // E nada mudou.
  igual(sql.prepare('select saldo_centavos from erp_titulos where id = ?').get(tituloId).saldo_centavos, 120000);
});

teste('baixa parcial anda o saldo e gera o lançamento do dinheiro', () => {
  const b = baixar(central, { tituloId, data: '2026-03-10', valor: 50000, meio: 'pix', ator: ATOR });
  igual(b.saldo, 70000);
  igual(b.status, 'parcial');

  const l = sql.prepare('select * from erp_lancamentos where id = ?').get(b.lancamentoId);
  igual(l.origem, 'baixa');

  // O dinheiro saiu do caixa (PIX a compensar) e a obrigação diminuiu.
  const s = saldos(sql, { instancia: 'MP' });
  igual(s.find((x) => x.conta === FORNECEDOR).saldo, 70000, 'a dívida caiu');
  igual(s.find((x) => x.conta === '1.1.01.003').saldo, -50000, 'saiu dinheiro do PIX');
});

teste('a segunda baixa quita, e a terceira é recusada', () => {
  const b = baixar(central, { tituloId, data: '2026-03-12', valor: 70000, meio: 'pix', ator: ATOR });
  igual(b.saldo, 0);
  igual(b.status, 'quitado');
  igual(recusa(() => baixar(central, { tituloId, data: '2026-03-13', valor: 100, ator: ATOR })).codigo,
    'ja_quitado');

  // A obrigação sumiu do passivo: pagou.
  igual(saldos(sql, { instancia: 'MP' }).find((x) => x.conta === FORNECEDOR).saldo, 0);
});

teste('título com baixa não se cancela — estorna-se a baixa antes', () => {
  const e = recusa(() => cancelar(central, { tituloId, motivo: 'desisti do serviço', ator: ATOR }));
  igual(e.codigo, 'tem_baixa');
  verdadeiro(/pagamento sem obrigação/.test(e.message), 'a recusa precisa dizer POR QUÊ');
});

teste('cancelar título sem baixa estorna o lançamento, e não o apaga', () => {
  const t = abrirTitulo(central, {
    instancia: 'FT', natureza: 'pagar', descricao: 'Pedido cancelado pelo fornecedor',
    emissao: '2026-03-05', vencimento: '2026-04-05', valor: 33000,
    conta: DESPESA, ator: ATOR,
  });
  const c = cancelar(central, { tituloId: t.id, motivo: 'fornecedor não entregou', ator: ATOR });
  igual(c.status, 'cancelado');
  verdadeiro(c.estornoId, 'cancelar tem de estornar');

  const orig = sql.prepare('select * from erp_lancamentos where id = ?').get(t.lancamentoId);
  verdadeiro(orig, 'o lançamento original continua existindo');
  igual(orig.estornado_por, c.estornoId);
  igual(sql.prepare('select saldo_centavos from erp_titulos where id = ?').get(t.id).saldo_centavos, 0);
});

teste('a carteira classifica por atraso, e o cálculo mora num lugar só', () => {
  abrirTitulo(central, {
    instancia: 'AF', natureza: 'receber', descricao: 'Venda a prazo',
    emissao: '2026-02-01', vencimento: '2026-02-10', valor: 240000,
    conta: RECEITA, ator: ATOR,
  });
  const c = carteira(sql, { natureza: 'receber', hoje: '2026-03-25' });
  const v = c.find((x) => x.descricao === 'Venda a prazo');
  igual(v.vencido, true);
  igual(v.atraso, 43);
  igual(v.faixa, 'ate_60');

  const p = posicao(sql, { hoje: '2026-03-25' });
  igual(p.porEmpresa.AF.receber, 240000);
  igual(p.porEmpresa.AF.receberVencido, 240000);
  igual(p.grupo.receber >= 240000, true, 'o grupo soma as empresas');
});

console.log('\n RATEIO ENTRE EMPRESAS\n');

teste('custo do grupo se divide sem sobrar nem faltar centavo', () => {
  /*
   * O caso real: a assinatura do sistema, paga por uma e usada por três. Sem
   * rateio o custo mora inteiro em quem pagou, e a margem das outras duas
   * aparece melhor do que é.
   */
  const r = ratearEntreEmpresas(sql, {
    data: '2026-03-28',
    historico: 'Assinatura do sistema, março',
    contaDespesa: '5.2.01.005',
    contaContrapartida: BANCO,
    total: 10000,
    pesos: { MP: 1, AF: 1, FT: 1 },
    ator: ATOR,
  });
  igual(r.total, 10000, 'a soma dos lançamentos tem de ser o total');
  igual(r.partes.join(','), '3334,3333,3333');
  igual(r.lancamentos.length, 3);

  const s = saldos(sql, { competencia: '2026-03' }).find((x) => x.conta === '5.2.01.005');
  igual(s.saldo, 10000, 'a despesa total no grupo é o valor cheio, nem mais nem menos');
});

console.log('\n CONFERÊNCIA DO LIVRO\n');

teste('depois de tudo, o livro continua saudável', () => {
  const c = conferir(sql);
  igual(c.desbalanceados.length, 0, 'não pode haver lançamento que não soma zero');
  igual(c.emSintetica.length, 0, 'não pode haver partida em conta sintética');
  igual(c.titulosTortos.length, 0, 'o saldo do título tem de bater com as baixas');
  igual(c.partidasOrfas, 0, 'não pode haver partida sem lançamento');
  igual(c.saudavel, true);

  const b = balancete(sql);
  igual(b.confere, true, `o livro inteiro tem de fechar (diferença ${b.diferenca})`);
  igual(b.diferenca, 0);
});

teste('a conferência ACUSA um livro sujo — senão não serve para nada', () => {
  /*
   * Um verificador que nunca reprova não é verificador. Aqui a sujeira é
   * plantada por baixo do módulo, direto no SQL, exatamente como um bug futuro
   * faria — e a conferência tem de vê-la.
   */
  const lanc = sql.prepare("select id from erp_lancamentos where origem = 'manual' limit 1").get();
  sql.prepare(
    "insert into erp_partidas (id, lancamento_id, conta, tipo, valor_centavos, ordem) values (?,?,?,?,?,?)",
  ).run('sujeira-1', lanc.id, CAIXA, 'D', 777, 99);

  const c = conferir(sql);
  igual(c.saudavel, false, 'a conferência tinha de acusar');
  igual(c.desbalanceados.length, 1);
  igual(c.desbalanceados[0].dif, 777);

  sql.prepare('delete from erp_partidas where id = ?').run('sujeira-1');
  igual(conferir(sql).saudavel, true, 'e volta a ficar limpa quando a sujeira sai');
});

teste('a competência sai da data, e data torta é recusada', () => {
  igual(competenciaDe('2026-03-15'), '2026-03');
  igual(competenciaDe('2026-03-15T10:00:00Z'), '2026-03');
  igual(recusa(() => competenciaDe('15/03/2026')).codigo, 'data_invalida');
  igual(recusa(() => competenciaDe(null)).codigo, 'data_invalida');
});

teste('GRUPO é uma instância como as outras, para o que não é de ninguém', () => {
  const r = lancar(sql, {
    instancia: GRUPO, data: '2026-03-30', historico: 'Honorários da holding', ator: ATOR,
    partidas: [
      { conta: DESPESA, tipo: 'D', valor_centavos: 45000 },
      { conta: BANCO, tipo: 'C', valor_centavos: 45000 },
    ],
  });
  verdadeiro(r.id);
  const s = saldos(sql, { instancia: GRUPO }).find((x) => x.conta === DESPESA);
  igual(s.saldo, 45000);
  igual(conferir(sql).saudavel, true);
});

console.log('\n PERMISSÃO POR MÓDULO\n');

teste('a semeadura destrava o soberano — senão o ERP nasce trancado para todos', () => {
  const r = semearAcesso(sql, ATOR);
  igual(r.criadas.length, Object.keys(MODULOS).length);
  igual(permissoesDe(sql, ATOR).rh, 'administrar');
  // Roda de novo e não duplica nem rebaixa.
  igual(semearAcesso(sql, 'outro@x.com').motivo, 'ja_existe_concessao');
});

teste('a checagem é conjunção: passa pela escala E tem o módulo', () => {
  /*
   * "Vê RH mas não vê Financeiro" não é um degrau da escala linear — é outro
   * eixo. Empilhar na escala obrigaria a promover o RH a gestor, e junto com a
   * folha ele levaria o financeiro inteiro.
   */
  conceder(sql, { email: 'rh@fortgrupo.com.br', modulo: 'rh', nivel: 'escrever', por: ATOR });

  igual(exigir(sql, { email: 'rh@fortgrupo.com.br', papel: 'gestor', modulo: 'rh' }).nivel, 'escrever');

  const e = recusa(() => exigir(sql, {
    email: 'rh@fortgrupo.com.br', papel: 'gestor', modulo: 'financeiro',
  }));
  igual(e.codigo, 'sem_permissao');
  igual(e.detalhe.modulo, 'financeiro');
  verdadeiro(/Financeiro/.test(e.message), 'a recusa precisa dizer QUAL módulo faltou');
});

teste('a escala barra antes do módulo, e diz que foi ela', () => {
  conceder(sql, { email: 'balcao@minaspecas.com.br', modulo: 'bi', nivel: 'ler', por: ATOR });
  const e = recusa(() => exigir(sql, {
    email: 'balcao@minaspecas.com.br', papel: 'operador', modulo: 'bi',
  }));
  igual(e.detalhe.exigido, 'gestor', 'quem barrou foi a escala, não o módulo');
});

teste('nível insuficiente é recusado, e a recusa diz o que a pessoa tem', () => {
  conceder(sql, { email: 'analista@fortgrupo.com.br', modulo: 'contas_pagar', nivel: 'ler', por: ATOR });
  igual(exigir(sql, { email: 'analista@fortgrupo.com.br', papel: 'gestor', modulo: 'contas_pagar' }).nivel, 'ler');
  const e = recusa(() => exigir(sql, {
    email: 'analista@fortgrupo.com.br', papel: 'gestor', modulo: 'contas_pagar', nivel: 'escrever',
  }));
  igual(e.detalhe.tem, 'ler');
  igual(e.detalhe.exigido, 'escrever');
});

teste('conceder acesso é do soberano — a permissão não se autoconcede', () => {
  conceder(sql, { email: 'gestor@fortgrupo.com.br', modulo: 'admin', nivel: 'administrar', por: ATOR });
  const e = recusa(() => exigir(sql, {
    email: 'gestor@fortgrupo.com.br', papel: 'gestor', modulo: 'admin', nivel: 'administrar',
  }));
  igual(e.detalhe.exigido, 'soberano');
  // E o soberano com a concessão passa.
  igual(exigir(sql, { email: ATOR, papel: 'soberano', modulo: 'admin', nivel: 'administrar' }).nivel,
    'administrar');
});

teste('soberano SEM concessão também é barrado — ver e administrar são poderes distintos', () => {
  const e = recusa(() => exigir(sql, {
    email: 'novo-soberano@fortgrupo.com.br', papel: 'soberano', modulo: 'rh',
  }));
  igual(e.detalhe.tem, null);
  verdadeiro(/RH/.test(e.message));
});

teste('revogar tira o acesso, e o mapa mostra quem tem o quê', () => {
  igual(revogar(sql, { email: 'rh@fortgrupo.com.br', modulo: 'rh' }).revogou, true);
  igual(recusa(() => exigir(sql, {
    email: 'rh@fortgrupo.com.br', papel: 'gestor', modulo: 'rh',
  })).codigo, 'sem_permissao');
  igual(revogar(sql, { email: 'rh@fortgrupo.com.br', modulo: 'rh' }).revogou, false, 'revogar duas vezes não quebra');

  const m = mapaDeAcesso(sql);
  verdadeiro(m.porPessoa[ATOR], 'o mapa precisa listar quem tem acesso');
  igual(m.porPessoa[ATOR].razao.nivel, 'administrar');
  igual(m.porPessoa[ATOR].razao.por, 'sistema');
});

teste('módulo ou nível inventado é recusado, e não concedido em silêncio', () => {
  igual(recusa(() => conceder(sql, { email: 'x@y.com', modulo: 'contabilidade', por: ATOR })).constructor,
    ErroDePermissao);
  igual(recusa(() => conceder(sql, { email: 'x@y.com', modulo: 'rh', nivel: 'tudo', por: ATOR })).constructor,
    ErroDePermissao);
  igual(recusa(() => conceder(sql, { email: 'sem-arroba', modulo: 'rh', por: ATOR })).constructor,
    ErroDePermissao);
});

fed.fecharTudo();
rmSync(DIR, { recursive: true, force: true });

console.log('');
console.log('  ─────────────────────────────────────────────');
console.log(`  ${passou} passaram · ${falhas.length} falharam`);
console.log('');
if (falhas.length) process.exit(1);
