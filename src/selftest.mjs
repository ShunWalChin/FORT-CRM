/**
 * Verificação do protótipo sem subir servidor nem instalar nada.
 *
 * Cobre o que, se quebrar, invalida a demonstração: isolamento entre empresas,
 * ordem das checagens de compliance, projeção de revisão, cadeia de auditoria e
 * idempotência do disparo. Roda com `node src/selftest.mjs`.
 */

import { rmSync } from 'node:fs';
import { Banco } from './db.mjs';
import { semear } from './seed.mjs';
import { avaliarCompliance, comRodape, classificarResposta, RODAPE_OPT_OUT } from './compliance.mjs';
import { projetarRevisao, renderizar, saudacao, tratamento } from './regua.mjs';
import { montarRegua } from './api.mjs';
import { consultarLimite, limparBaldes, tamanhoBaldes, origemDe } from './limite.mjs';

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

function igual(a, b, msg) {
  if (a !== b) throw new Error(`${msg ?? 'valores diferentes'} — esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
}

function verdadeiro(v, msg) {
  if (!v) throw new Error(msg ?? 'esperava verdadeiro');
}

const AGORA = Date.now();
const HORAS = (n) => new Date(AGORA - n * 3600000).toISOString();
const DIAS = (n) => new Date(AGORA - n * 86400000).toISOString();

const base = {
  canalTipo: 'whatsapp_evolution',
  canalConectado: true,
  corpo: 'Mensagem de teste.',
  automatizado: true,
  consentimento: true,
  optOutEm: null,
  ultimoInboundEm: HORAS(2),
  ultimoDisparoDoGatilhoEm: null,
  cooldownMs: 24 * 3600000,
  temTemplateAprovado: false,
  blocklist: [],
  agoraMs: AGORA,
};

console.log('\n COMPLIANCE\n');

teste('libera dentro da janela de 24h', () => {
  const d = avaliarCompliance(base);
  verdadeiro(d.permitido, 'deveria liberar');
  igual(d.politica, 'standard_24h');
});

teste('bloqueia fora da janela no Evolution', () => {
  const d = avaliarCompliance({ ...base, ultimoInboundEm: DIAS(3) });
  verdadeiro(!d.permitido);
  igual(d.motivo, 'outside_24h');
});

teste('WhatsApp Cloud aceita template fora da janela', () => {
  const d = avaliarCompliance({
    ...base, canalTipo: 'whatsapp_cloud', ultimoInboundEm: DIAS(3), temTemplateAprovado: true,
  });
  verdadeiro(d.permitido);
  igual(d.politica, 'template_outside_window');
});

teste('WhatsApp Cloud sem template aprovado é recusado com motivo próprio', () => {
  const d = avaliarCompliance({
    ...base, canalTipo: 'whatsapp_cloud', ultimoInboundEm: DIAS(3), temTemplateAprovado: false,
  });
  igual(d.motivo, 'template_not_approved');
});

teste('opt-out vence a janela aberta', () => {
  const d = avaliarCompliance({ ...base, optOutEm: DIAS(1) });
  igual(d.motivo, 'opted_out');
});

teste('canal desconectado vence o opt-out — a ordem das checagens importa', () => {
  const d = avaliarCompliance({ ...base, canalConectado: false, optOutEm: DIAS(1) });
  igual(d.motivo, 'channel_not_connected');
});

teste('sem consentimento não entra em régua automática', () => {
  const d = avaliarCompliance({ ...base, consentimento: false });
  igual(d.motivo, 'sem_consentimento');
});

teste('sem consentimento não bloqueia envio humano', () => {
  const d = avaliarCompliance({ ...base, consentimento: false, automatizado: false });
  verdadeiro(d.permitido);
});

teste('cooldown do gatilho bloqueia repetição', () => {
  const d = avaliarCompliance({ ...base, ultimoDisparoDoGatilhoEm: HORAS(3) });
  igual(d.motivo, 'trigger_cooldown');
});

teste('cooldown não se aplica a envio humano', () => {
  const d = avaliarCompliance({ ...base, ultimoDisparoDoGatilhoEm: HORAS(3), automatizado: false });
  verdadeiro(d.permitido);
});

teste('blocklist age sobre o corpo final, com rodapé já inserido', () => {
  const corpo = comRodape('Aproveite: renda extra garantida');
  const d = avaliarCompliance({ ...base, corpo, blocklist: ['renda extra'] });
  igual(d.motivo, 'blocklisted_content');
});

teste('sem inbound nenhum, não há janela para abrir', () => {
  const d = avaliarCompliance({ ...base, ultimoInboundEm: null });
  igual(d.motivo, 'no_inbound_interaction');
});

teste('teto de caracteres do Instagram é menor que o do WhatsApp', () => {
  const longo = 'x'.repeat(1200);
  igual(avaliarCompliance({ ...base, canalTipo: 'instagram', corpo: longo }).motivo, 'texto_excede_limite');
  verdadeiro(avaliarCompliance({ ...base, canalTipo: 'whatsapp_evolution', corpo: longo }).permitido);
});

teste('rodapé de descadastro é inserido uma única vez', () => {
  const uma = comRodape('Olá');
  const duas = comRodape(uma);
  igual(uma, duas);
  verdadeiro(uma.includes(RODAPE_OPT_OUT));
});

teste('resposta ambígua vira unknown, nunca sent nem failed', () => {
  igual(classificarResposta({ status: 0, erro: 'timeout' }), 'unknown');
  igual(classificarResposta({ status: 503 }), 'unknown');
  igual(classificarResposta({ status: 200 }), 'sent');
  igual(classificarResposta({ status: 400 }), 'failed');
});

console.log('\n RÉGUA\n');

teste('projeta a revisão pela média de rodagem', () => {
  const p = projetarRevisao(
    { km_ultima: 380000, media_km_mes: 9000, ultima_visita_em: DIAS(60) }, AGORA,
  );
  verdadeiro(p, 'deveria projetar');
  igual(p.alvoKm, 400000);
  verdadeiro(p.kmEstimadoHoje > 380000, 'o veículo rodou desde a última visita');
  verdadeiro(p.diasFaltando > 0 && p.diasFaltando < 90, `dias fora do esperado: ${p.diasFaltando}`);
});

teste('sem média de rodagem não há projeção — melhor vazio que aviso errado', () => {
  igual(projetarRevisao({ km_ultima: 100000, media_km_mes: 0 }, AGORA), null);
  igual(projetarRevisao({ km_ultima: null, media_km_mes: 5000 }, AGORA), null);
});

teste('template preenche variáveis e apaga as que faltam', () => {
  igual(renderizar('Olá {{nome}}, placa {{placa}}{{inexistente}}', { nome: 'Ana', placa: 'ABC1D23' }),
    'Olá Ana, placa ABC1D23');
});

teste('pessoa é chamada pelo primeiro nome; empresa, pela razão social sem sufixo', () => {
  igual(tratamento('Sebastião Alves Pereira'), 'Sebastião');
  igual(tratamento('Antônio Ribeiro Sobrinho'), 'Antônio');
  igual(tratamento('Fazenda Boa Vista LTDA'), 'Fazenda Boa Vista');
  igual(tratamento('Transportes Norte Mineiro'), 'Transportes Norte Mineiro');
  igual(tratamento('Empório Sabor de Minas'), 'Empório Sabor de Minas');
  igual(tratamento(''), '');
});

teste('saudação varia com a hora e nunca deixa vírgula solta', () => {
  igual(saudacao({ nome: 'Ana Souza' }, new Date('2026-08-24T09:00:00').getTime()), 'Bom dia, Ana');
  igual(saudacao({ nome: '' }, new Date('2026-08-24T20:00:00').getTime()), 'Boa noite');
});

console.log('\n BANCO E ISOLAMENTO\n');

// Duas empresas no MESMO banco, de propósito: é o cenário que exercita o
// isolamento LÓGICO por `empresa_id`. Na federação cada uma tem o seu arquivo
// e o isolamento é físico — mas a barreira lógica continua valendo, e é aqui
// que ela é provada.
const banco = new Banco(':memory:');
semear(banco, { empresa: 'MP' });
semear(banco, { empresa: 'AF' });
const sql = banco.sistema();
const [mp, af] = ['MP', 'AF'].map((c) => sql.prepare('select * from empresas where codigo = ?').get(c));

teste('uma instância pode hospedar mais de uma empresa', () => {
  igual(sql.prepare('select count(*) as n from empresas').get().n, 2);
  igual(sql.prepare('select count(*) as n from empresas where codigo = ?').get('MP').n, 1);
  igual(sql.prepare('select count(*) as n from empresas where codigo = ?').get('AF').n, 1);
});

teste('consulta sem contexto de empresa é recusada', () => {
  let recusou = false;
  try { banco.para(null); } catch { recusou = true; }
  verdadeiro(recusou, 'deveria recusar escopo vazio');
});

teste('consulta sem marcador de escopo é recusada', () => {
  let recusou = false;
  try { banco.para(mp.id).todas('select * from clientes'); } catch { recusou = true; }
  verdadeiro(recusou, 'query sem {ESCOPO} tinha que ser recusada');
});

teste('a oficina não enxerga cliente da fazenda, nem sabendo o id exato', () => {
  const daFazenda = banco.para(af.id).todas('select * from clientes where {ESCOPO} limit 1')[0];
  verdadeiro(daFazenda, 'a fazenda precisa ter cliente');
  const visto = banco.para(mp.id).uma('select * from clientes where {ESCOPO} and id = ?', daFazenda.id);
  igual(visto, null, 'vazamento entre empresas');
});

teste('update travado no tenant não altera linha de outra empresa', () => {
  const daFazenda = banco.para(af.id).todas('select * from clientes where {ESCOPO} limit 1')[0];
  const mudou = banco.para(mp.id).atualizar('clientes', daFazenda.id, { nome: 'INVADIDO' });
  igual(mudou, 0, 'não podia alterar');
  igual(banco.para(af.id).uma('select nome from clientes where {ESCOPO} and id = ?', daFazenda.id).nome,
    daFazenda.nome);
});

teste('delete travado no tenant não apaga linha de outra empresa', () => {
  const daFazenda = banco.para(af.id).todas('select * from clientes where {ESCOPO} limit 1')[0];
  igual(banco.para(mp.id).remover('clientes', daFazenda.id), 0);
  verdadeiro(banco.para(af.id).uma('select id from clientes where {ESCOPO} and id = ?', daFazenda.id));
});

teste('insert carimba a empresa do escopo, ignorando o que vier no corpo', () => {
  const escopo = banco.para(mp.id);
  const r = escopo.inserir('clientes', {
    id: 'teste-carimbo', empresa_id: af.id, nome: 'Tentativa de gravar na outra empresa',
    perfil: 'particular', origem: 'teste', consentimento_lgpd: 0, criado_em: new Date().toISOString(),
  });
  igual(r.empresa_id, mp.id, 'o escopo tem que sobrescrever o empresa_id do corpo');
  igual(banco.para(af.id).uma('select id from clientes where {ESCOPO} and id = ?', 'teste-carimbo'), null);
});

teste('leitura consolidada exige motivo textual', () => {
  let recusou = false;
  try { banco.grupo('curto'); } catch { recusou = true; }
  verdadeiro(recusou, 'motivo curto tinha que ser recusado');
  verdadeiro(banco.grupo('painel consolidado para reuniao do grupo'));
});

console.log('\n AUDITORIA\n');

teste('a cadeia começa íntegra', () => {
  igual(banco.verificarCadeia().length, 0);
});

teste('novos registros mantêm a cadeia íntegra', () => {
  banco.auditar({ empresaId: mp.id, ator: 'teste', acao: 'a.b', dados: { x: 1 } });
  banco.auditar({ empresaId: af.id, ator: 'teste', acao: 'a.c', dados: { x: 2 } });
  igual(banco.verificarCadeia().length, 0);
});

teste('audit_log recusa UPDATE e DELETE', () => {
  let recusouUpdate = false, recusouDelete = false;
  try { sql.exec("update audit_log set ator = 'outro' where seq = 1"); } catch { recusouUpdate = true; }
  try { sql.exec('delete from audit_log where seq = 1'); } catch { recusouDelete = true; }
  verdadeiro(recusouUpdate, 'UPDATE tinha que ser bloqueado');
  verdadeiro(recusouDelete, 'DELETE tinha que ser bloqueado');
});

console.log('\n DADOS DA DEMONSTRAÇÃO\n');

teste('a régua da oficina tem candidatos hoje', () => {
  const fila = montarRegua(banco, banco.para(mp.id), mp);
  verdadeiro(fila.length > 0, 'a fila não pode estar vazia no dia da demonstração');
  verdadeiro(fila.some((f) => f.decisao.permitido), 'precisa haver ao menos um liberado');
  verdadeiro(fila.some((f) => !f.decisao.permitido), 'precisa haver ao menos um bloqueado para mostrar o motivo');
});

teste('a régua da fazenda tem candidatos hoje', () => {
  const fila = montarRegua(banco, banco.para(af.id), af);
  verdadeiro(fila.length > 0, 'a fila da fazenda não pode estar vazia');
});

teste('idempotência: mesma chave no mesmo dia não grava duas vezes', () => {
  const escopo = banco.para(mp.id);
  const cliente = escopo.todas('select * from clientes where {ESCOPO} limit 1')[0];
  const chave = 'gatilho:cliente:2026-01-01';
  const linha = {
    cliente_id: cliente.id, gatilho_chave: 'teste', canal_tipo: 'whatsapp_evolution',
    corpo: 'x', status: 'sent', politica: 'standard_24h', motivo: null,
    idempotency_key: chave, criado_em: new Date().toISOString(),
  };
  escopo.inserir('disparos', { id: 'd1', ...linha });
  let recusou = false;
  try { escopo.inserir('disparos', { id: 'd2', ...linha }); } catch { recusou = true; }
  verdadeiro(recusou, 'o índice único tinha que recusar a segunda gravação');
});

teste('dinheiro é inteiro em centavos, nunca float', () => {
  const valores = sql.prepare('select valor_centavos from ordens_servico').all();
  verdadeiro(valores.length > 0);
  for (const v of valores) {
    verdadeiro(Number.isInteger(v.valor_centavos), `valor não inteiro: ${v.valor_centavos}`);
  }
});


teste('cada gatilho gera no máximo uma linha por contato', () => {
  for (const empresa of [mp, af]) {
    const fila = montarRegua(banco, banco.para(empresa.id), empresa);
    const ids = fila.map((f) => f.id);
    igual(new Set(ids).size, ids.length,
      `ids repetidos na fila de ${empresa.codigo} — a tela mostraria linhas que a idempotência engoliria`);
    const parImpar = fila.map((f) => `${f.gatilho.chave}|${f.cliente.id}`);
    igual(new Set(parImpar).size, parImpar.length, 'mesmo gatilho repetido para o mesmo contato');
  }
});

teste('o caso agrupado é anunciado no contexto, não escondido', () => {
  const fila = montarRegua(banco, banco.para(mp.id), mp);
  const agrupado = fila.find((f) => f.contexto.includes('e mais'));
  verdadeiro(agrupado, 'a carga tem cliente com vários veículos — deveria haver agrupamento visível');
});

teste('a recarga da base é rápida — uma transação, não 250 commits', () => {
  const arquivo = new URL('../data/selftest-tmp.db', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const limpar = () => {
    for (const sufixo of ['', '-wal', '-shm']) rmSync(arquivo + sufixo, { force: true });
  };
  limpar();
  const b = new Banco(arquivo);
  semear(b);
  const ini = Date.now();
  semear(b, { empresa: 'MP', reset: true });
  const ms = Date.now() - ini;
  b.fechar();
  limpar();
  // Sem transação isto levava ~25 segundos e travava o processo inteiro, porque
  // node:sqlite é síncrono e cada INSERT virava um commit com fsync. O limite
  // é folgado de propósito: o que se quer pegar é a ordem de grandeza.
  verdadeiro(ms < 5000, `recarga levou ${ms}ms — provavelmente perdeu a transação`);
});

console.log('\n LIMITE DE REQUISIÇÕES\n');

const reqFalso = (metodo, caminho, ip) => ({
  method: metodo, url: caminho, headers: { 'cf-connecting-ip': ip }, socket: {},
});

teste('login tem teto baixo — senha não vira oráculo de força bruta', () => {
  const t0 = 1_000_000;
  let bloqueou = 0;
  for (let i = 0; i < 20; i += 1) {
    const r = consultarLimite(reqFalso('POST', '/api/sessao', '10.0.0.1'), t0 + i);
    if (!r.permitido) bloqueou += 1;
  }
  verdadeiro(bloqueou > 0, 'deveria bloquear depois do teto');
  igual(consultarLimite(reqFalso('POST', '/api/sessao', '10.0.0.1'), t0 + 21).max, 12);
});

teste('o teto é por origem — um IP abusando não derruba os outros', () => {
  const t0 = 2_000_000;
  for (let i = 0; i < 20; i += 1) consultarLimite(reqFalso('POST', '/api/sessao', '10.0.0.2'), t0 + i);
  igual(consultarLimite(reqFalso('POST', '/api/sessao', '10.0.0.2'), t0 + 21).permitido, false);
  igual(consultarLimite(reqFalso('POST', '/api/sessao', '10.0.0.3'), t0 + 21).permitido, true,
    'outro IP não pode herdar o bloqueio');
});

teste('leitura tem teto maior que escrita', () => {
  const t0 = 3_000_000;
  const leitura = consultarLimite(reqFalso('GET', '/api/clientes', '10.0.0.4'), t0);
  const escrita = consultarLimite(reqFalso('POST', '/api/clientes', '10.0.0.4'), t0);
  verdadeiro(leitura.max > escrita.max, `leitura ${leitura.max} deveria superar escrita ${escrita.max}`);
});

teste('recarregar a demonstração é a rota mais restrita', () => {
  const t0 = 4_000_000;
  igual(consultarLimite(reqFalso('POST', '/api/demo/reiniciar', '10.0.0.5'), t0).max, 3);
});

teste('a janela desliza — passado um minuto, libera de novo', () => {
  const t0 = 5_000_000;
  for (let i = 0; i < 20; i += 1) consultarLimite(reqFalso('POST', '/api/sessao', '10.0.0.6'), t0 + i);
  igual(consultarLimite(reqFalso('POST', '/api/sessao', '10.0.0.6'), t0 + 100).permitido, false);
  igual(consultarLimite(reqFalso('POST', '/api/sessao', '10.0.0.6'), t0 + 61_000).permitido, true);
});

teste('a faxina descarta baldes vencidos — o Map não cresce para sempre', () => {
  const t0 = 6_000_000;
  for (let i = 0; i < 30; i += 1) consultarLimite(reqFalso('GET', '/api/painel', `10.1.0.${i}`), t0);
  verdadeiro(tamanhoBaldes() > 0);
  limparBaldes(t0 + 120_000);
  igual(tamanhoBaldes(), 0, 'todos os baldes deveriam ter vencido');
});

teste('cabeçalho forjável não substitui o do Cloudflare', () => {
  const req = {
    method: 'GET', url: '/api/painel', socket: { remoteAddress: '192.168.0.9' },
    headers: { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4' },
  };
  igual(origemDe(req), '203.0.113.7');
});

banco.fechar();

console.log('');
console.log('  ─────────────────────────────────────────────');
console.log(`  ${passou} passaram · ${falhas.length} falharam`);
console.log('');
if (falhas.length) process.exit(1);
