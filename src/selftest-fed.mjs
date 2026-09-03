/**
 * Testes da federação, da atribuição e da conversão offline.
 *
 * Separado de `selftest.mjs` porque cobre outra camada: lá é o CRM de uma
 * empresa; aqui é o que só existe quando há várias instâncias e quando o que
 * acontece no funil precisa voltar para as plataformas de anúncio.
 */

import { rmSync } from 'node:fs';
import { Federacao, CATALOGO } from './federacao.mjs';
import { semear } from './seed.mjs';
import {
  sincronizarCentral, resumoConsolidado, consultarConsolidado, receberLead,
  garantirChaves, listarChaves, resolverChave,
} from './central.mjs';
import { canaisDe, canal, diagnosticar, rotularOrigem, TIPOS } from './canais.mjs';
import {
  extrairMensagens, validarAssinatura, responderDesafio, eventoBM, EVENTOS_BM,
  montarMetaBusinessMessaging, dentroDaJanela,
} from './ctwa.mjs';
import { createHmac } from 'node:crypto';
import {
  extrairAtribuicao, inferirPlataforma, montarFbc, normalizarEmail,
  normalizarTelefone, normalizarTexto, identificadoresHash, podeCorresponder, temSinal,
} from './atribuicao.mjs';
import {
  avaliarConversao, chaveIdempotencia, classificarResposta, dataGoogleAds,
  eventoDaEtapa, montarGoogleAds, montarMetaCapi, podeRepetirSozinho, esperaDeRetentativa,
} from './conversoes.mjs';
import { drenarEventos, despacharConversoes, registrarMudancaDeEtapa } from './conversoes-servico.mjs';
import { novoId, agora } from './db.mjs';
import { reancorar, ancoraDe, diagnosticoDaAncora } from './reancorar.mjs';
import { montarRegua } from './api.mjs';
import { hashSenha, verificarSenha, ehHash, migrarSenhas, avaliarForca } from './senha.mjs';

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

console.log('\n ATRIBUIÇÃO\n');

teste('extrai os parâmetros de clique de uma URL real', () => {
  const a = extrairAtribuicao(
    'https://loja.com.br/tintas?gclid=ABC123&utm_source=google&utm_medium=cpc&utm_campaign=tintas',
  );
  igual(a.gclid, 'ABC123');
  igual(a.utm_campaign, 'tintas');
  igual(a.plataforma, 'google_ads');
});

teste('orgânico do Google não vira google_ads', () => {
  igual(inferirPlataforma({ utm_source: 'google', utm_medium: 'organic' }), 'organico');
  igual(inferirPlataforma({ utm_source: 'google', utm_medium: 'cpc' }), 'google_ads');
  igual(inferirPlataforma({ utm_source: 'facebook', utm_medium: 'social' }), 'organico');
  igual(inferirPlataforma({ fbclid: 'x', utm_medium: 'organic' }), 'meta_ads',
    'parâmetro de clique é prova e vence a declaração');
});

teste('fbc é montado a partir do fbclid quando o cookie não veio', () => {
  const fbc = montarFbc('IwAR123', '2026-09-01T12:00:00.000Z');
  verdadeiro(/^fb\.1\.\d+\.IwAR123$/.test(fbc), `formato errado: ${fbc}`);
  igual(montarFbc(null), null);
});

teste('gmail normaliza ponto e rótulo — mesma caixa, mesmo hash', () => {
  igual(normalizarEmail('Joao.Silva+loja@Gmail.com'), 'joaosilva@gmail.com');
  igual(normalizarEmail('joaosilva@gmail.com'), 'joaosilva@gmail.com');
  igual(normalizarEmail('Ana.Paula+x@empresa.com.br'), 'ana.paula@empresa.com.br',
    'fora do gmail o ponto é significativo');
});

teste('telefone sai nas duas formas — Google quer +, Meta não', () => {
  const t = normalizarTelefone('(38) 99811-2233');
  igual(t.e164, '+5538998112233');
  igual(t.digitos, '5538998112233');
  igual(normalizarTelefone('123'), null);
});

teste('as duas formas de telefone geram hashes DIFERENTES', () => {
  const h = identificadoresHash({ nome: 'Ana Souza', telefone: '38998112233', email: 'a@b.com' });
  verdadeiro(h.fone_sha256 !== h.fone_digitos_sha256,
    'se fossem iguais, uma das plataformas não casaria e ninguém perceberia');
});

teste('acento e pontuação somem do texto normalizado', () => {
  igual(normalizarTexto('São Paulo'), 'saopaulo');
  igual(normalizarTexto('Antônio'), 'antonio');
});

teste('sem clique e sem pessoa, não há como corresponder', () => {
  igual(podeCorresponder({}, {}).pode, false);
  igual(podeCorresponder({ gclid: 'x' }, {}).porClique, true);
  igual(podeCorresponder({}, { email_sha256: 'x' }).porPessoa, true);
});

teste('atribuição vazia não merece linha', () => {
  igual(temSinal({}), false);
  igual(temSinal({ gclid: 'x' }), true);
  igual(temSinal({ utm_campaign: 'natal' }), true);
});

console.log('\n CONVERSÃO OFFLINE\n');

teste('data do Google Ads não é ISO — espaço e fuso explícito', () => {
  const d = dataGoogleAds('2026-09-03T15:30:00.000Z', -180);
  igual(d, '2026-09-03 12:30:00-03:00');
  verdadeiro(!d.includes('T'), 'ISO com T é recusado pela API');
});

teste('etapa vira evento de conversão', () => {
  igual(eventoDaEtapa('ganho').chave, 'venda');
  igual(eventoDaEtapa('qualificado').chave, 'lead_qualificado');
  igual(eventoDaEtapa('novo'), null);
});

teste('venda sem valor é recusada — não ensina retorno', () => {
  const base = {
    destinoConfigurado: true, consentimento: true,
    atribuicao: { gclid: 'x' }, hashes: { email_sha256: 'h' },
  };
  igual(avaliarConversao({ ...base, evento: 'venda', valorCentavos: 0 }).motivo, 'valor_obrigatorio');
  verdadeiro(avaliarConversao({ ...base, evento: 'venda', valorCentavos: 5000 }).permitido);
  verdadeiro(avaliarConversao({ ...base, evento: 'lead_qualificado', valorCentavos: 0 }).permitido,
    'lead qualificado vale sem valor — o sinal é a qualidade');
});

teste('sem consentimento nenhum hash sai daqui', () => {
  const d = avaliarConversao({
    destinoConfigurado: true, consentimento: false,
    atribuicao: { gclid: 'x' }, hashes: { email_sha256: 'h' },
    evento: 'lead_qualificado', valorCentavos: 0,
  });
  igual(d.motivo, 'sem_consentimento');
});

teste('destino não configurado vence o resto — a ordem importa', () => {
  const d = avaliarConversao({
    destinoConfigurado: false, consentimento: false,
    atribuicao: {}, hashes: {}, evento: 'venda', valorCentavos: 0,
  });
  igual(d.motivo, 'destino_nao_configurado');
});

teste('Google Ads manda UM parâmetro de clique, nunca dois', () => {
  const p = montarGoogleAds({
    cliente: { id: 'c1', nome: 'Ana Souza', email: 'a@b.com', telefone: '38998112233' },
    atribuicao: { gclid: 'G1', gbraid: 'B1', wbraid: 'W1' },
    evento: 'venda', valorCentavos: 12345, moeda: 'BRL',
    ocorridoEm: agora(), destino: { identificador: '123', acao: 'customers/1/conversionActions/2' },
  });
  const c = p.corpo.conversions[0];
  igual(c.gclid, 'G1');
  igual(c.gbraid, undefined, 'mandar dois é erro de validação na API');
  igual(c.wbraid, undefined);
  igual(c.conversionValue, 123.45, 'centavos viram reais com duas casas');
  igual(p.corpo.partialFailure, true);
});

teste('Meta CAPI usa o telefone SEM o +, diferente do Google', () => {
  const cliente = {
    id: 'c1', nome: 'Ana Souza', email: 'a@b.com', telefone: '38998112233', cidade: 'Januária',
  };
  const ctx = {
    cliente, atribuicao: { fbc: 'fb.1.100.X', fbp: 'fb.1.2.3' },
    evento: 'venda', valorCentavos: 5000, moeda: 'BRL',
    ocorridoEm: agora(), destino: { identificador: 'pix' }, idempotencyKey: 'k1',
  };
  const meta = montarMetaCapi(ctx);
  const google = montarGoogleAds({ ...ctx, destino: { identificador: '1', acao: 'a' } });

  const phMeta = meta.corpo.data[0].user_data.ph[0];
  const phGoogle = google.corpo.conversions[0].userIdentifiers
    .find((u) => u.hashedPhoneNumber)?.hashedPhoneNumber;

  verdadeiro(phMeta !== phGoogle, 'as duas plataformas exigem formatos diferentes');
  igual(meta.corpo.data[0].event_name, 'Purchase');
  igual(meta.corpo.data[0].action_source, 'system_generated');
  igual(meta.corpo.data[0].event_id, 'k1', 'event_id é o que desduplica contra o Pixel');
  igual(meta.corpo.data[0].user_data.fbc, 'fb.1.100.X');
});

teste('resposta ambígua vira desconhecido, nunca repetição', () => {
  igual(classificarResposta({ status: 0, erro: 'timeout' }), 'desconhecido');
  igual(classificarResposta({ status: 503 }), 'desconhecido');
  igual(classificarResposta({ status: 200 }), 'enviado');
  igual(classificarResposta({ status: 400 }), 'falhou');
});

teste('a chave de idempotência separa duas vendas do mesmo cliente', () => {
  const a = chaveIdempotencia({ evento: 'venda', clienteId: 'c1', oportunidadeId: 'o1', destino: 'google_ads' });
  const b = chaveIdempotencia({ evento: 'venda', clienteId: 'c1', oportunidadeId: 'o2', destino: 'google_ads' });
  const c = chaveIdempotencia({ evento: 'venda', clienteId: 'c1', oportunidadeId: 'o1', destino: 'meta_capi' });
  verdadeiro(a !== b, 'oportunidades diferentes são vendas diferentes');
  verdadeiro(a !== c, 'cada destino recebe a sua');
});

console.log('\n FEDERAÇÃO\n');

const DIR = new URL('../data/teste-fed/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
rmSync(DIR, { recursive: true, force: true });
const fed = new Federacao(DIR);
for (const e of CATALOGO) semear(fed.abrir(e.codigo), { empresa: e.codigo });

teste('cada empresa tem o SEU banco', () => {
  igual(fed.codigosDeEmpresa().length, 3);
  const arquivos = fed.existentes();
  for (const e of CATALOGO) verdadeiro(arquivos.includes(e.codigo), `falta o banco de ${e.codigo}`);
});

teste('cada instância contém UMA empresa, e só a dela', () => {
  for (const e of CATALOGO) {
    const linhas = fed.abrir(e.codigo).sistema().prepare('select codigo from empresas').all();
    igual(linhas.length, 1, `${e.codigo} deveria ter uma empresa`);
    igual(linhas[0].codigo, e.codigo);
  }
});

teste('isolamento físico: o cliente da oficina não existe no banco da loja', () => {
  const mp = fed.abrir('MP');
  const emp = mp.sistema().prepare('select id from empresas limit 1').get();
  const cliente = mp.para(emp.id).todas('select * from clientes where {ESCOPO} limit 1')[0];
  verdadeiro(cliente, 'a oficina precisa ter cliente');

  const ft = fed.abrir('FT');
  const achado = ft.sistema().prepare('select id from clientes where id = ?').get(cliente.id);
  igual(achado, undefined, 'a linha não pode existir no outro arquivo');
});

teste('instância desconhecida é recusada', () => {
  let recusou = false;
  try { fed.abrir('XX'); } catch { recusou = true; }
  verdadeiro(recusou);
});

teste('consulta federada carimba a instância de origem', () => {
  const { linhas } = fed.consultar(['MP', 'AF', 'FT'], (banco) => {
    const emp = banco.sistema().prepare('select id from empresas limit 1').get();
    return banco.para(emp.id).todas('select id, nome from clientes where {ESCOPO} limit 3');
  });
  igual(linhas.length, 9);
  for (const l of linhas) verdadeiro(l._instancia, 'sem carimbo, ids de empresas diferentes colidem');
  igual(new Set(linhas.map((l) => l._instancia)).size, 3);
});

teste('instância com falha não derruba as outras', () => {
  const { linhas, falhas: f } = fed.consultar(['MP', 'AF'], (banco) => {
    const emp = banco.sistema().prepare('select id, codigo from empresas limit 1').get();
    if (emp.codigo === 'AF') throw new Error('instância fora do ar');
    return banco.para(emp.id).todas('select id from clientes where {ESCOPO} limit 2');
  });
  igual(linhas.length, 2, 'a instância sã devolve normalmente');
  igual(f.length, 1);
  igual(f[0].instancia, 'AF');
});

console.log('\n INSTÂNCIA CENTRAL\n');

const sinc = sincronizarCentral(fed);

teste('a central recebe os leads das três instâncias', () => {
  igual(sinc.porInstancia.length, 3);
  for (const p of sinc.porInstancia) verdadeiro(p.linhas > 0, `${p.instancia} não sincronizou`);
  const r = resumoConsolidado(fed.abrirCentral());
  igual(r.total, sinc.linhas);
  igual(r.porInstancia.length, 3);
});

teste('sincronizar duas vezes não duplica', () => {
  const antes = resumoConsolidado(fed.abrirCentral()).total;
  sincronizarCentral(fed);
  sincronizarCentral(fed);
  igual(resumoConsolidado(fed.abrirCentral()).total, antes,
    'a chave é (instância, cliente) — reprocessar atualiza, não duplica');
});

teste('a central sabe de que plataforma cada lead veio', () => {
  const plataformas = resumoConsolidado(fed.abrirCentral()).porPlataforma.map((p) => p.plataforma);
  verdadeiro(plataformas.includes('google_ads'), 'deveria haver lead de Google Ads');
  verdadeiro(plataformas.includes('meta_ads'), 'deveria haver lead de Meta');
});

teste('a consulta consolidada filtra por instância', () => {
  const so = consultarConsolidado(fed.abrirCentral(), { instancia: 'FT' });
  verdadeiro(so.length > 0);
  verdadeiro(so.every((l) => l.instancia === 'FT'));
});

teste('lead externo sem destino fica aguardando triagem', () => {
  const central = fed.abrirCentral();
  igual(receberLead(central, { fonte: 'formulario', payload: {} }).status, 'recebido');

  const r2 = receberLead(central, { fonte: 'formulario', destino: 'FT', payload: {} });
  igual(r2.status, 'roteado');
  igual(r2.destino, 'FT');

  igual(receberLead(central, { fonte: 'formulario', destino: 'INEXISTENTE', payload: {} }).status,
    'recebido', 'destino inválido não roteia para lugar nenhum');
});

console.log('\n CICLO COMPLETO DE CONVERSÃO\n');

teste('mover para ganho gera evento, conversão e payload das duas plataformas', () => {
  const banco = fed.abrir('FT');
  const emp = banco.sistema().prepare('select * from empresas limit 1').get();
  const escopo = banco.para(emp.id);

  const comAtr = escopo.todas(
    `select c.* from clientes c join atribuicoes a on a.cliente_id = c.id
     where c.{ESCOPO} and c.consentimento_lgpd = 1 limit 1`,
  )[0];
  verdadeiro(comAtr, 'a carga precisa ter cliente com atribuição');

  const opId = novoId();
  escopo.inserir('oportunidades', {
    id: opId, cliente_id: comAtr.id, titulo: 'Teste de conversão', etapa: 'ganho',
    valor_centavos: 250000, probabilidade: 100, posicao: 9999, motivo_perda: null,
    criado_em: agora(), atualizado_em: agora(),
  });

  const chave = registrarMudancaDeEtapa(escopo, {
    oportunidade: escopo.uma('select * from oportunidades where {ESCOPO} and id = ?', opId),
    etapaAnterior: 'negociacao', ator: 'teste',
  });
  igual(chave, 'venda');

  const dren = drenarEventos(banco, escopo);
  verdadeiro(dren.enfileiradas >= 2, `esperava uma conversão por destino, veio ${dren.enfileiradas}`);

  const desp = despacharConversoes(banco, escopo, emp, { ator: 'teste' });
  verdadeiro(desp.enviadas >= 2, `esperava despacho aos dois destinos, veio ${desp.enviadas}`);

  const linhas = escopo.todas('select * from conversoes where {ESCOPO} and oportunidade_id = ?', opId);
  igual(linhas.map((l) => l.destino).sort().join(','), 'google_ads,meta_capi');
  for (const l of linhas) {
    const p = JSON.parse(l.payload);
    verdadeiro(p.endpoint, 'payload sem endpoint');
    verdadeiro(p.corpo, 'payload sem corpo');
  }
});

teste('drenar duas vezes não enfileira de novo', () => {
  const banco = fed.abrir('FT');
  const emp = banco.sistema().prepare('select * from empresas limit 1').get();
  const escopo = banco.para(emp.id);
  const antes = escopo.contar('conversoes');
  drenarEventos(banco, escopo);
  drenarEventos(banco, escopo);
  igual(escopo.contar('conversoes'), antes, 'consumido_por impede reprocessar');
});

teste('cliente sem consentimento tem a conversão BLOQUEADA, não enviada', () => {
  const banco = fed.abrir('MP');
  const emp = banco.sistema().prepare('select * from empresas limit 1').get();
  const escopo = banco.para(emp.id);

  const sem = escopo.todas('select * from clientes where {ESCOPO} and consentimento_lgpd = 0 limit 1')[0];
  verdadeiro(sem, 'a carga precisa ter cliente sem consentimento');

  const opId = novoId();
  escopo.inserir('oportunidades', {
    id: opId, cliente_id: sem.id, titulo: 'Sem consentimento', etapa: 'ganho',
    valor_centavos: 100000, probabilidade: 100, posicao: 8888, motivo_perda: null,
    criado_em: agora(), atualizado_em: agora(),
  });
  registrarMudancaDeEtapa(escopo, {
    oportunidade: escopo.uma('select * from oportunidades where {ESCOPO} and id = ?', opId),
    etapaAnterior: 'negociacao', ator: 'teste',
  });
  drenarEventos(banco, escopo);
  despacharConversoes(banco, escopo, emp, { ator: 'teste' });

  const linhas = escopo.todas('select * from conversoes where {ESCOPO} and oportunidade_id = ?', opId);
  verdadeiro(linhas.length > 0);
  for (const l of linhas) {
    igual(l.status, 'bloqueado');
    igual(l.motivo, 'sem_consentimento');
  }
});

console.log('\n REANCORAGEM DA DEMONSTRAÇÃO\n');

teste('a âncora existe logo após a carga', () => {
  const b = fed.abrir('MP');
  verdadeiro(ancoraDe(b), 'sem âncora não há como saber a idade da demonstração');
  const d = diagnosticoDaAncora(b);
  verdadeiro(typeof d.horas === 'number');
  igual(d.envelhecida, false, 'carga recém-feita não pode estar envelhecida');
});

teste('deslocar por poucos segundos é recusado', () => {
  const b = fed.abrir('MP');
  const emp = b.sistema().prepare('select id from empresas limit 1').get();
  const r = reancorar(b, b.para(emp.id), { ator: 'teste' });
  igual(r.deslocouSegundos, 0);
  igual(r.motivo, 'ancora_recente', 'deslocar segundos só sujaria a auditoria');
});

teste('reancorar desliza a história e devolve a fila', () => {
  const b = fed.abrir('AF');
  const emp = b.sistema().prepare('select * from empresas limit 1').get();
  const esc = b.para(emp.id);

  // Envelhece à força: empurra a história 30 horas para TRÁS, como se o
  // relógio tivesse andado desde a carga.
  const sql = b.sistema();
  for (const [t, cols] of [['clientes', ['ultimo_inbound_em']], ['pedidos', ['feito_em']]]) {
    for (const c of cols) {
      sql.prepare(
        `update ${t} set ${c} = strftime('%Y-%m-%dT%H:%M:%fZ', ${c}, '-30 hours') `
        + `where empresa_id = ? and ${c} is not null`,
      ).run(emp.id);
    }
  }
  const antes = montarRegua(b, esc, emp).filter((f) => f.decisao.permitido).length;

  // E move a âncora para trás, para que o deslocamento tenha o que corrigir.
  const r = reancorar(b, esc, { ator: 'teste', minimoSegundos: 0 });
  verdadeiro(r.deslocouSegundos >= 0);

  const depois = montarRegua(b, esc, emp).filter((f) => f.decisao.permitido).length;
  verdadeiro(depois >= antes, `a fila não podia encolher: ${antes} → ${depois}`);
});

teste('reancorar NÃO quebra a cadeia de auditoria', () => {
  for (const cod of ['MP', 'AF', 'FT']) {
    const b = fed.abrir(cod);
    igual(b.verificarCadeia().length, 0, `cadeia de ${cod} quebrada após reancorar`);
  }
});

teste('nulo continua nulo — descadastro não nasce por efeito colateral', () => {
  const b = fed.abrir('FT');
  const emp = b.sistema().prepare('select id from empresas limit 1').get();
  const esc = b.para(emp.id);
  const semOptOutAntes = esc.contar('clientes', 'and opt_out_em is null');
  reancorar(b, esc, { ator: 'teste', minimoSegundos: 0 });
  igual(esc.contar('clientes', 'and opt_out_em is null'), semOptOutAntes,
    'deslocar data não pode inventar descadastro para quem não tinha');
});

console.log('\n SENHA\n');

teste('hash confere a senha certa e recusa a errada', () => {
  const h = hashSenha('segredo-forte-9');
  verdadeiro(verificarSenha('segredo-forte-9', h));
  igual(verificarSenha('segredo-forte-8', h), false);
});

teste('a mesma senha gera hashes diferentes — o sal e por registro', () => {
  const a = hashSenha('igual123');
  const b = hashSenha('igual123');
  verdadeiro(a !== b, 'sem sal por registro, duas contas com a mesma senha se denunciam');
  verdadeiro(verificarSenha('igual123', a) && verificarSenha('igual123', b));
});

teste('texto claro nunca e aceito como se fosse hash', () => {
  igual(verificarSenha('demo', 'demo'), false,
    'aceitar comparacao crua manteria a porta aberta para bancos antigos');
  igual(ehHash('demo'), false);
  igual(ehHash(hashSenha('demo')), true);
});

teste('hash corrompido e recusado sem lancar excecao', () => {
  igual(verificarSenha('x', 'scrypt$16384$8$1$naoehbase64!!!'), false);
  igual(verificarSenha('x', 'scrypt$'), false);
  igual(verificarSenha('x', null), false);
});

teste('os parametros de custo viajam DENTRO do registro', () => {
  const h = hashSenha('teste-1234', { n: 1024 });
  verdadeiro(h.startsWith('scrypt$1024$'), `parametros ausentes: ${h.slice(0, 20)}`);
  verdadeiro(verificarSenha('teste-1234', h),
    'sem os parametros gravados, endurecer o custo invalidaria as senhas antigas');
});

teste('a migracao converte texto claro e nao remexe no que ja e hash', () => {
  const b = fed.abrir('MP');
  const sql = b.sistema();
  const u = sql.prepare('select id from usuarios limit 1').get();
  sql.prepare('update usuarios set senha = ? where id = ?').run('emtextoclaro', u.id);

  const r = migrarSenhas(b);
  igual(r.migradas, 1);
  verdadeiro(r.jaEmHash >= 1, 'os outros ja deviam estar em hash');

  const depois = sql.prepare('select senha from usuarios where id = ?').get(u.id);
  verdadeiro(ehHash(depois.senha));
  verdadeiro(verificarSenha('emtextoclaro', depois.senha), 'a senha precisa continuar valendo');

  igual(migrarSenhas(b).migradas, 0, 'rodar de novo nao pode re-hashear');
});

teste('a politica recusa senha curta e a que repete o e-mail', () => {
  igual(avaliarForca('abc').aceitavel, false);
  igual(avaliarForca('somenteletras').aceitavel, false, 'falta numero ou simbolo');
  igual(avaliarForca('diretoria2026', { email: 'diretoria@fortgrupo.com.br' }).aceitavel, false,
    'senha que contem o proprio e-mail e a primeira que se tenta');
  igual(avaliarForca('Tinta-Forte-2026').aceitavel, true);
});


/* ── Canais de entrada ────────────────────────────────────────────────────── */

teste('cada empresa tem o proprio catalogo de canais', () => {
  const mp = canaisDe('MP').map((x) => x.id);
  const af = canaisDe('AF').map((x) => x.id);
  const ft = canaisDe('FT').map((x) => x.id);

  verdadeiro(mp.length >= 8 && af.length >= 8 && ft.length >= 8, 'catalogo raso demais');

  // A regressao que motivou o catalogo: as tres empresas dividiam a MESMA
  // lista, e canais de oficina de injecao apareciam na fazenda e na loja.
  verdadeiro(mp.includes('guincho_24h'), 'guincho pertence a oficina');
  verdadeiro(!af.includes('guincho_24h'), 'fazenda de queijo nao recebe lead de guincho');
  verdadeiro(!ft.includes('guincho_24h'), 'loja de tinta nao recebe lead de guincho');
  verdadeiro(!af.includes('site_diagnostico'), 'fazenda nao faz diagnostico de bomba injetora');
  verdadeiro(!ft.includes('site_diagnostico'), 'loja de tinta nao faz diagnostico');

  // E o que e proprio de cada uma existe.
  verdadeiro(af.includes('emporio_revenda') && af.includes('assinatura'), 'canais da fazenda');
  verdadeiro(ft.includes('pintor_parceiro') && ft.includes('construtora_obra'), 'canais da loja');
});

teste('so canal com parametro de clique e atribuivel', () => {
  igual(canal('MP', 'balcao').atribuivel, false, 'quem entra pela porta nao clicou em anuncio');
  igual(canal('MP', 'telefone').atribuivel, false);
  igual(canal('MP', 'guincho_24h').atribuivel, false);
  igual(canal('MP', 'google_ads_form').atribuivel, true);
  igual(canal('FT', 'whatsapp_anuncio').atribuivel, true, 'click-to-whatsapp traz ctwa_clid');
  igual(canal('AF', 'site_pedido').atribuivel, true);

  // WhatsApp organico NAO e atribuivel — e o erro classico, porque o numero e
  // o mesmo que o anuncio usa. So o clique distingue um do outro.
  igual(canal('AF', 'whatsapp').atribuivel, false, 'whatsapp organico nao carrega clique');
});

teste('origem fora do catalogo volta marcada, nunca adivinhada', () => {
  const bom = rotularOrigem('MP', 'guincho_24h');
  igual(bom.conhecido, true);
  igual(bom.nome, 'Guincho parceiro 24h');

  const orfao = rotularOrigem('MP', 'planilha_antiga_2019');
  igual(orfao.conhecido, false, 'origem importada desconhecida precisa aparecer como tal');
  igual(orfao.nome, 'planilha_antiga_2019', 'nao pode inventar um nome bonito');
  igual(orfao.atribuivel, false);
});

teste('a carga so da origem atribuivel a quem tem parametro de clique', () => {
  for (const cod of ['MP', 'AF', 'FT']) {
    const b = fed.abrir(cod);
    const emp = b.sistema().prepare('select * from empresas limit 1').get();
    const esc = b.para(emp.id);
    const linhas = esc.todas(
      'select c.origem as origem, a.gclid as gclid, a.fbclid as fbclid'
      + ' from clientes c left join atribuicoes a'
      + "   on a.cliente_id = c.id and a.toque = 'primeiro'"
      + ' where c.{ESCOPO}',
    );
    verdadeiro(linhas.length > 0, cod + ' sem clientes');

    for (const l of linhas) {
      const meta = canal(cod, l.origem);
      verdadeiro(meta, cod + ': origem "' + l.origem + '" fora do catalogo da empresa');
      // O contrario nao vale: canal atribuivel pode nao ter clique (alguem
      // digitou o endereco do formulario). Clique sem canal pago e que e
      // impossivel, e era o que a carga antiga produzia.
      if (l.gclid || l.fbclid) {
        verdadeiro(meta.atribuivel,
          cod + ': cliente com clique veio de "' + l.origem + '", que nao e canal pago');
      }
    }
  }
});

teste('o diagnostico separa o que da para atribuir do que nao da', () => {
  const d = diagnosticar('MP', { balcao: 6, google_ads_form: 2, site_diagnostico: 2 });
  igual(d.total, 10);
  igual(d.atribuiveis, 4);
  igual(d.naoAtribuiveis, 6);
  igual(d.cobertura, 40, 'quatro de dez');
  igual(d.orfaos.length, 0);

  const comOrfao = diagnosticar('AF', { whatsapp: 3, importado_xls: 5 });
  igual(comOrfao.orfaos.length, 1, 'origem desconhecida tem de aparecer separada');
  igual(comOrfao.orfaos[0].id, 'importado_xls');
  igual(comOrfao.total, 8, 'orfao conta no total — senao a cobertura mente para mais');
});

teste('todo canal declara tipo valido, atribuicao e explicacao', () => {
  for (const cod of ['MP', 'AF', 'FT']) {
    for (const c of canaisDe(cod)) {
      verdadeiro(TIPOS[c.tipo], cod + '/' + c.id + ': tipo "' + c.tipo + '" desconhecido');
      igual(typeof c.atribuivel, 'boolean', cod + '/' + c.id);
      verdadeiro(c.nota && c.nota.length > 20, cod + '/' + c.id + ' sem explicacao');
    }
  }
});

/* ── Chave de captacao — a porta publica ──────────────────────────────────── */

teste('a chave de captacao e criada uma vez e preservada', () => {
  const central = fed.abrirCentral();
  const primeira = garantirChaves(central, CATALOGO);
  igual(primeira.length, CATALOGO.length);

  // Preservar nao e detalhe: a chave vai colada no HTML do site do cliente.
  // Regenerar na subida quebraria todo formulario publicado, em silencio, e o
  // sintoma apareceria dias depois como "paramos de receber lead".
  const segunda = garantirChaves(central, CATALOGO);
  igual(segunda.map((x) => x.chave).join(','), primeira.map((x) => x.chave).join(','),
    'rodar de novo nao pode trocar a chave');

  verdadeiro(primeira.every((x) => x.chave.length > 24), 'chave curta demais para ficar publica');
  verdadeiro(primeira.every((x) => x.chave.startsWith(x.codigo.toLowerCase() + '_')));
});

teste('resolver a chave conta o uso; chave desconhecida some sem pista', () => {
  const central = fed.abrirCentral();
  garantirChaves(central, CATALOGO);
  const alvo = listarChaves(central, 'MP')[0];

  const antes = alvo.usos;
  const r = resolverChave(central, alvo.chave);
  verdadeiro(r, 'a chave valida tem de resolver');
  igual(r.codigo, 'MP');
  igual(listarChaves(central, 'MP')[0].usos, antes + 1, 'uso nao contabilizado');

  igual(resolverChave(central, 'nao_existe_mesmo'), null);
  igual(resolverChave(central, ''), null);
  igual(resolverChave(central, null), null);

  // Desativada tem de se comportar igual a inexistente — senao a porta vira
  // oraculo e da para descobrir quais chaves existem testando uma a uma.
  central.sistema().prepare('update chaves_captacao set ativa = 0 where chave = ?').run(alvo.chave);
  igual(resolverChave(central, alvo.chave), null, 'chave desativada nao pode resolver');
  central.sistema().prepare('update chaves_captacao set ativa = 1 where chave = ?').run(alvo.chave);
});

teste('lead da porta publica cai na central com o clique ja extraido', () => {
  const central = fed.abrirCentral();
  garantirChaves(central, CATALOGO);
  const alvo = listarChaves(central, 'FT')[0];
  const destino = resolverChave(central, alvo.chave);

  const atr = extrairAtribuicao(
    { gclid: 'CjTESTE123', utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'tinta-obra' },
    { paginaEntrada: 'https://exemplo.com.br/orcamento' },
  );
  const r = receberLead(central, {
    fonte: 'site_orcamento',
    destino: destino.codigo,
    payload: { nome: 'Teste da Porta', telefone: '38999990000', atribuicao: atr },
  });

  igual(r.destino, 'FT');
  igual(r.status, 'roteado');

  const salvo = central.sistema().prepare('select * from entrada_leads where id = ?').get(r.id);
  igual(salvo.gclid, 'CjTESTE123', 'o parametro de clique precisa ser extraido na CHEGADA');
  igual(salvo.utm_campaign, 'tinta-obra');
  verdadeiro(salvo.payload.includes('Teste da Porta'));
});

teste('lead sem destino fica em triagem, nao e descartado', () => {
  const central = fed.abrirCentral();
  const r = receberLead(central, { fonte: 'formulario', destino: null, payload: { nome: 'Sem Dono' } });
  igual(r.status, 'recebido');
  igual(r.destino, null);
  const salvo = central.sistema().prepare('select * from entrada_leads where id = ?').get(r.id);
  verdadeiro(salvo.motivo && salvo.motivo.includes('triagem'), 'precisa dizer por que parou');
});

teste('recarregar sem dizer a empresa e recusado, nao grava a MP por cima', () => {
  // O bug real: `semear` tem `empresa = 'MP'` como padrao, e `recarregarDemo`
  // omitia o parametro. Recarregar a Agrofort gravava a Minas Pecas por cima —
  // linha de `empresas` inclusive — e as tres instancias passavam a se
  // apresentar como MP. Ficou escondido porque a rota quebrava antes de chegar
  // ali; consertar o crash foi o que revelou o estrago.
  const af = fed.abrir('AF');

  let recusou = false;
  try { semear(af, { reset: true }); } catch { recusou = true; }
  verdadeiro(recusou, 'reset sem empresa explicita tem de falhar alto');

  const depoisDaTentativa = af.sistema().prepare('select codigo from empresas limit 1').get();
  igual(depoisDaTentativa.codigo, 'AF', 'a tentativa recusada nao pode ter mexido na base');

  // Com o codigo certo, recarrega e continua sendo AF.
  semear(af, { empresa: 'AF', reset: true });
  const emp = af.sistema().prepare('select codigo, nome from empresas limit 1').get();
  igual(emp.codigo, 'AF');
  igual(emp.nome, 'Fazenda Agrofort');

  // E as origens continuam sendo as da fazenda, nao as da oficina.
  const esc = af.para(emp.id ?? af.sistema().prepare('select id from empresas limit 1').get().id);
  const origens = esc.todas('select origem from clientes where {ESCOPO} group by origem')
    .map((r) => r.origem);
  verdadeiro(origens.length > 0, 'a recarga precisa ter gerado clientes');
  for (const o of origens) {
    verdadeiro(canal('AF', o), `origem "${o}" nao pertence ao catalogo da Agrofort`);
  }
  verdadeiro(!origens.includes('guincho_24h') && !origens.includes('site_diagnostico'),
    'canal de oficina de injecao nao pode aparecer na fazenda depois da recarga');
});

/* ── Click-to-WhatsApp ────────────────────────────────────────────────────── */

const WEBHOOK_CTWA = {
  object: 'whatsapp_business_account',
  entry: [{
    id: 'WABA_123',
    changes: [{
      field: 'messages',
      value: {
        metadata: { display_phone_number: '5538998491017', phone_number_id: 'PN_1' },
        contacts: [{ profile: { name: 'Joana da Obra' }, wa_id: '5538988887777' }],
        messages: [{
          from: '5538988887777', id: 'wamid.ABC1', timestamp: '1788446400',
          type: 'text', text: { body: 'Quero orcamento de tinta' },
          referral: {
            source_type: 'ad', source_id: '120000000000001',
            source_url: 'https://fb.me/X', headline: 'Tinta com 30% off',
            ctwa_clid: 'AR_CLIQUE_001',
          },
        }],
      },
    }],
  }],
};

teste('o webhook e percorrido inteiro, nao so entry[0].changes[0]', () => {
  const dois = {
    entry: [
      { id: 'W1', changes: [{ field: 'messages', value: { messages: [{ from: '1', id: 'm1', type: 'text' }] } }] },
      { id: 'W2', changes: [
        { field: 'messages', value: { messages: [{ from: '2', id: 'm2', type: 'text' }] } },
        { field: 'messages', value: { messages: [{ from: '3', id: 'm3', type: 'text' }] } },
      ] },
    ],
  };
  const m = extrairMensagens(dois);
  igual(m.length, 3, 'ler so a primeira entrada descarta mensagem sem erro nenhum');
  igual(m.map((x) => x.wamid).join(','), 'm1,m2,m3');
  igual(m[1].waba_id, 'W2', 'cada mensagem carrega o WABA da PROPRIA entrada');
});

teste('a primeira mensagem de anuncio traz o ctwa_clid', () => {
  const [m] = extrairMensagens(WEBHOOK_CTWA);
  igual(m.ctwa_clid, 'AR_CLIQUE_001');
  igual(m.waba_id, 'WABA_123');
  igual(m.source_ad_id, '120000000000001', 'source_id e o Ad ID, nao o clique');
  igual(m.wa_id, '5538988887777');
  igual(m.wamid, 'wamid.ABC1');
  igual(m.de_anuncio, true);
  igual(m.sem_ctwa, false);
  igual(m.recebido_em, new Date(1788446400 * 1000).toISOString(), 'timestamp e Unix em SEGUNDOS');
});

teste('anuncio sem ctwa_clid e MARCADO, nunca preenchido', () => {
  // Acontece de verdade: posicionamento em Status do WhatsApp chega como
  // anuncio e sem o clique. Inventar um valor produziria evento que a Meta
  // aceita e que nunca casa com anuncio nenhum — o painel mostraria conversao
  // e o anunciante confiaria nela.
  const semClique = JSON.parse(JSON.stringify(WEBHOOK_CTWA));
  delete semClique.entry[0].changes[0].value.messages[0].referral.ctwa_clid;
  const [m] = extrairMensagens(semClique);
  igual(m.de_anuncio, true);
  igual(m.ctwa_clid, null, 'nao pode inventar clique');
  igual(m.sem_ctwa, true, 'a ausencia precisa ficar registrada');
});

teste('conversa organica nao ganha atribuicao inventada', () => {
  const organica = {
    entry: [{ id: 'W1', changes: [{ field: 'messages', value: {
      contacts: [{ wa_id: '5538911112222', profile: { name: 'Passante' } }],
      messages: [{ from: '5538911112222', id: 'wamid.ORG', type: 'text', text: { body: 'oi' } }],
    } }] }],
  };
  const [m] = extrairMensagens(organica);
  igual(m.de_anuncio, false);
  igual(m.ctwa_clid, null);
  igual(m.sem_ctwa, false, 'organica nao e "anuncio sem clique"; e outra coisa');
});

teste('a assinatura e conferida sobre os BYTES, em tempo constante', () => {
  const segredo = 'segredo-do-app';
  const bruto = JSON.stringify(WEBHOOK_CTWA);
  const boa = 'sha256=' + createHmac('sha256', segredo).update(Buffer.from(bruto, 'utf8')).digest('hex');

  igual(validarAssinatura(bruto, boa, segredo).valida, true);
  igual(validarAssinatura(bruto, boa, 'outro-segredo').valida, false);
  igual(validarAssinatura(bruto + ' ', boa, segredo).valida, false, 'um byte a mais invalida');
  igual(validarAssinatura(bruto, 'sha256=00', segredo).motivo, 'assinatura_invalida');
  igual(validarAssinatura(bruto, null, segredo).motivo, 'sem_assinatura');

  // Sem segredo configurado a porta fica FECHADA. O contrario funciona em
  // desenvolvimento, vai para producao sem a variavel e vira endpoint publico
  // de escrita.
  igual(validarAssinatura(bruto, boa, null).valida, false);
  igual(validarAssinatura(bruto, boa, null).motivo, 'sem_segredo');

  // O erro classico: assinar o objeto reserializado em vez dos bytes.
  const reserializado = JSON.stringify(JSON.parse(bruto.replace('{"object"', '{ "object"')));
  const daReserializacao = 'sha256='
    + createHmac('sha256', segredo).update(reserializado).digest('hex');
  verdadeiro(daReserializacao !== boa || reserializado === bruto,
    'reserializar muda os bytes — por isso o HMAC tem de ser sobre o bruto');
});

teste('o desafio do webhook so responde com o token certo', () => {
  const p = { 'hub.mode': 'subscribe', 'hub.verify_token': 'certo', 'hub.challenge': '9988' };
  igual(responderDesafio(p, 'certo').corpo, '9988');
  igual(responderDesafio(p, 'errado').ok, false);
  igual(responderDesafio(p, null).ok, false, 'sem token esperado nao pode passar');
  igual(responderDesafio({ ...p, 'hub.mode': 'unsubscribe' }, 'certo').ok, false);
});

teste('Schedule e Opportunity NAO existem na lista de Business Messaging', () => {
  // Sao os nomes naturais para "reuniao marcada" e "oportunidade criada", e
  // nao estao na lista aceita. Mandar assim vira evento customizado, que pode
  // ser aceito e nao fica elegivel para otimizacao de campanha CTWA.
  verdadeiro(!EVENTOS_BM.has('Schedule'));
  verdadeiro(!EVENTOS_BM.has('Opportunity'));
  verdadeiro(!EVENTOS_BM.has('Lead'), 'em BM o nome e QualifiedLead/LeadSubmitted');

  igual(eventoBM('reuniao_marcada').nome, 'QualifiedLead');
  igual(eventoBM('reuniao_marcada').estagio, 'schedule');
  igual(eventoBM('oportunidade_criada').nome, 'QualifiedLead');
  igual(eventoBM('oportunidade_criada').estagio, 'opportunity');
  igual(eventoBM('venda').nome, 'Purchase');

  // Tres etapas viram QualifiedLead; so o funnel_stage distingue.
  const nomes = new Set(['lead_qualificado', 'reuniao_marcada', 'oportunidade_criada']
    .map((k) => eventoBM(k).nome));
  igual(nomes.size, 1);
  const estagios = new Set(['lead_qualificado', 'reuniao_marcada', 'oportunidade_criada']
    .map((k) => eventoBM(k).estagio));
  igual(estagios.size, 3, 'sem funnel_stage as tres etapas ficariam indistinguiveis');
});

teste('o payload de mensageria usa ctwa_clid e WABA em texto limpo', () => {
  const r = montarMetaBusinessMessaging({
    evento: 'lead_qualificado',
    ctwaClid: 'AR_CLIQUE_001',
    wabaId: 'WABA_123',
    ocorridoEm: new Date().toISOString(),
    idempotencyKey: 'prod:lead-1:qualified',
    leadId: 'lead-1',
    destino: { identificador: 'DATASET_9' },
  });
  igual(r.erro, null);
  const ev = r.corpo.data[0];

  igual(ev.action_source, 'business_messaging');
  igual(ev.messaging_channel, 'whatsapp');
  igual(ev.event_name, 'QualifiedLead');
  igual(ev.custom_data.funnel_stage, 'qualified');

  // NAO hasheados: sao identificadores de clique e de ativo, nao dado pessoal.
  // Hashear faz o evento ser aceito e nunca casar com anuncio nenhum.
  igual(ev.user_data.ctwa_clid, 'AR_CLIQUE_001');
  igual(ev.user_data.whatsapp_business_account_id, 'WABA_123');
  igual(ev.user_data.ctwa_clid.length, 'AR_CLIQUE_001'.length, 'nao pode virar hash de 64 chars');

  // Nao ha navegador nesta rota: inventar fbc/fbp seria inventar jornada.
  igual(ev.user_data.fbc, undefined);
  igual(ev.user_data.fbp, undefined);
  igual(ev.event_source_url, undefined, 'mensageria nao tem URL de origem');

  verdadeiro(r.endpoint.includes('DATASET_9'));
});

teste('mensageria sem ctwa_clid nao monta payload, e diz por que', () => {
  const r = montarMetaBusinessMessaging({
    evento: 'venda', ctwaClid: null, wabaId: 'WABA_123',
    ocorridoEm: new Date().toISOString(), idempotencyKey: 'x',
  });
  igual(r.corpo, null);
  igual(r.erro, 'sem_ctwa_clid');

  igual(montarMetaBusinessMessaging({
    evento: 'venda', ctwaClid: 'A', wabaId: null,
    ocorridoEm: new Date().toISOString(), idempotencyKey: 'x',
  }).erro, 'sem_waba_id');
});

teste('a venda em mensageria leva valor, moeda e order id', () => {
  const r = montarMetaBusinessMessaging({
    evento: 'venda', ctwaClid: 'AR_1', wabaId: 'W_1',
    ocorridoEm: new Date().toISOString(), valorCentavos: 1250000, moeda: 'BRL',
    idempotencyKey: 'prod:purchase:OS-91', pedidoId: 'OS-91',
  });
  const ev = r.corpo.data[0];
  igual(ev.event_name, 'Purchase');
  igual(ev.custom_data.value, 12500);
  igual(ev.custom_data.currency, 'BRL');
  igual(ev.custom_data.order_id, 'OS-91');
});

teste('event_time e Unix em SEGUNDOS, nunca milissegundos', () => {
  const quando = '2026-09-03T12:00:00.000Z';
  const r = montarMetaBusinessMessaging({
    evento: 'lead_qualificado', ctwaClid: 'A', wabaId: 'W',
    ocorridoEm: quando, idempotencyKey: 'k',
  });
  const t = r.corpo.data[0].event_time;
  igual(t, Math.floor(new Date(quando).getTime() / 1000));
  // Milissegundos passam pela validacao de tipo e caem milhares de anos no
  // futuro: o evento e descartado sem erro visivel.
  verdadeiro(t < 1e11, 'ficou em milissegundos');
});

teste('a janela de 7 dias e barrada ANTES de chamar a Meta', () => {
  const agoraMs = Date.parse('2026-09-03T12:00:00Z');
  const dias = (n) => new Date(agoraMs - n * 86400000).toISOString();

  igual(dentroDaJanela(dias(1), agoraMs).dentro, true);
  igual(dentroDaJanela(dias(6.9), agoraMs).dentro, true);
  igual(dentroDaJanela(dias(8), agoraMs).dentro, false);
  igual(dentroDaJanela(dias(8), agoraMs).motivo, 'fora_da_janela_de_7_dias');

  // Barrar aqui importa porque a fila tem retentativa: um evento velho que
  // falha vira tentativa infinita, e o motivo real fica escondido atras de um
  // erro generico de validacao.
  igual(dentroDaJanela(new Date(agoraMs + 86400000).toISOString(), agoraMs).motivo, 'data_no_futuro');
  igual(dentroDaJanela('nao e data', agoraMs).motivo, 'data_invalida');
});

teste('ctwa_clid conta como sinal e classifica como meta_ads', () => {
  const atr = extrairAtribuicao({ ctwa_clid: 'AR_CLIQUE_001' }, {});
  igual(atr.ctwa_clid, 'AR_CLIQUE_001');
  igual(inferirPlataforma(atr), 'meta_ads', 'clique de CTWA e anuncio pago da Meta');
  igual(temSinal(atr), true, 'sem isso o lead de CTWA passaria por "sem atribuicao"');
  igual(atr.fbc, null, 'nao ha fbclid nem navegador — fbc nao pode ser fabricado');
});

teste('o local da conversao manda no action_source, nao a origem do lead', () => {
  // A regra que mais se erra: o lead nasce no WhatsApp e a venda fecha na
  // loja. Rotular como business_messaging porque o lead veio do WhatsApp e
  // reportar mentira para quem decide a verba.
  const cliente = { id: 'c1', nome: 'Joana Silva', telefone: '38988887777', email: 'j@ex.com', cidade: 'Januária' };
  const base = {
    cliente, evento: 'venda', valorCentavos: 500000, moeda: 'BRL',
    ocorridoEm: new Date().toISOString(), idempotencyKey: 'k1',
    destino: { identificador: 'DS' },
  };

  const noChat = montarMetaCapi({ ...base, atribuicao: { ctwa_clid: 'AR_9', waba_id: 'W_9' } });
  igual(noChat.corpo.data[0].action_source, 'business_messaging');

  const naLoja = montarMetaCapi({
    ...base,
    atribuicao: { ctwa_clid: 'AR_9', waba_id: 'W_9' },
    localConversao: 'physical_store',
  });
  igual(naLoja.corpo.data[0].action_source, 'physical_store',
    'o lead veio do WhatsApp, mas a venda foi na loja');
  igual(naLoja.corpo.data[0].messaging_channel, undefined);
  verdadeiro(naLoja.corpo.data[0].user_data.ph, 'fora da mensageria o telefone hasheado volta a valer');

  const porTelefone = montarMetaCapi({ ...base, atribuicao: { fbclid: 'IwAR9', fbc: 'fb.1.100.IwAR9' }, localConversao: 'phone_call' });
  igual(porTelefone.corpo.data[0].action_source, 'phone_call');
  // fbc vale aqui: ele so existe porque houve uma visita web de verdade. O
  // proibido e fabricar onde visita nenhuma houve.
  igual(porTelefone.corpo.data[0].user_data.fbc, 'fb.1.100.IwAR9');
});

teste('429 e 400 sao opostos e nao podem cair no mesmo balde', () => {
  // 429 e "voce mandou rapido demais": o evento esta CERTO e a mesma tentativa,
  // mais tarde, funciona. 400 e "o evento esta errado": repetir produz o mesmo
  // 400 para sempre. Tratar os dois como 'falhou' joga fora conversao boa num
  // pico de trafego, ou repete lixo para sempre.
  igual(classificarResposta({ status: 429 }), 'limitado');
  igual(classificarResposta({ status: 400 }), 'falhou');
  igual(classificarResposta({ status: 401 }), 'sem_permissao');
  igual(classificarResposta({ status: 403 }), 'sem_permissao');
  igual(classificarResposta({ status: 200 }), 'enviado');
  igual(classificarResposta({ status: 503 }), 'desconhecido');
  igual(classificarResposta({ status: 0, erro: 'timeout' }), 'desconhecido');
});

teste('so o limite de taxa se repete sozinho', () => {
  igual(podeRepetirSozinho('limitado'), true);
  igual(podeRepetirSozinho('falhou'), false, '400 repetido produz o mesmo 400');
  igual(podeRepetirSozinho('sem_permissao'), false, 'token nao se conserta sozinho');

  // O caso que mais importa: resposta nunca chegou. A conversao PODE ter sido
  // registrada do outro lado, e repetir arrisca contar duas vezes — numero
  // inflado vira decisao de verba errada.
  igual(podeRepetirSozinho('desconhecido'), false, 'ambiguidade nunca se repete sozinha');
  igual(podeRepetirSozinho('enviado'), false);
});

teste('a espera cresce e tem jitter', () => {
  const amostras = [0, 1, 2, 3, 8].map((t) => esperaDeRetentativa(t));
  verdadeiro(amostras.every((ms) => ms >= 2500 && ms <= 300000), 'espera fora da faixa');
  verdadeiro(amostras[3] > amostras[0], 'a espera precisa crescer');
  verdadeiro(esperaDeRetentativa(20) <= 300000, 'tem de ter teto');

  // Sem jitter, tudo o que ficou represado volta no mesmo instante e leva 429
  // de novo, em coro.
  const repetidas = new Set(Array.from({ length: 12 }, () => esperaDeRetentativa(3)));
  verdadeiro(repetidas.size > 1, 'sem jitter as retentativas voltam em coro');
});

teste('o action_source declarado fica em coluna, nao so no blob', () => {
  const b = fed.abrir('MP');
  const emp = b.sistema().prepare('select * from empresas limit 1').get();
  const esc = b.para(emp.id);

  // Faz uma oportunidade chegar em 'ganho' e roda a cadeia inteira, em vez de
  // depender do que outro teste deixou para tras.
  const cli = esc.uma('select * from clientes where {ESCOPO} and consentimento_lgpd = 1 limit 1');
  const opId = novoId();
  esc.inserir('oportunidades', {
    id: opId, cliente_id: cli.id, titulo: 'Auditoria de action_source', etapa: 'ganho',
    valor_centavos: 250000, criado_em: agora(), atualizado_em: agora(),
  });
  registrarMudancaDeEtapa(esc, {
    oportunidade: esc.uma('select * from oportunidades where {ESCOPO} and id = ?', opId),
    etapaAnterior: 'negociacao', ator: 'teste',
  });
  drenarEventos(b, esc);
  despacharConversoes(b, esc, emp, { ator: 'teste' });

  const linhas = esc.todas(
    "select action_source, payload from conversoes where {ESCOPO} and oportunidade_id = ?", opId,
  );
  verdadeiro(linhas.length > 0, 'nenhuma conversao foi despachada');

  for (const l of linhas) {
    verdadeiro(l.action_source, 'action_source vazio — a auditoria nao teria o que responder');
    // Tem de bater com o que de fato foi montado no payload.
    const p = JSON.parse(l.payload);
    const noPayload = p?.corpo?.data?.[0]?.action_source ?? null;
    if (noPayload) {
      igual(l.action_source, noPayload, 'a coluna divergiu do que foi enviado');
    }
  }
});

fed.fecharTudo();
rmSync(DIR, { recursive: true, force: true });

console.log('');
console.log('  ─────────────────────────────────────────────');
console.log(`  ${passou} passaram · ${falhas.length} falharam`);
console.log('');
if (falhas.length) process.exit(1);
