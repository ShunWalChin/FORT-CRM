/**
 * Servidor do protótipo. node:http puro, sem framework — o objetivo é que
 * `node server.mjs` funcione num notebook sem npm install, sem Docker e sem
 * rede, que é a condição real de uma demonstração na sala do cliente.
 *
 * Ligado a 127.0.0.1 por padrão. Superfície zero é axioma da doutrina, e este
 * protótipo não tem autenticação forte o bastante para ganhar porta pública.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, normalize } from 'node:path';
import { Federacao, CATALOGO, CENTRAL } from './src/federacao.mjs';
import { semear } from './src/seed.mjs';
import { garantirChaves, sincronizarCentral } from './src/central.mjs';
import { migrarSenhas } from './src/senha.mjs';
import { ROTAS, ROTAS_HTML, ErroHttp, ok, erro, DEMO_MODE } from './src/api.mjs';
import { consultarLimite, limparBaldes } from './src/limite.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PORTA = Number(process.env.PORT ?? 4501);
const HOST = process.env.HOST ?? '127.0.0.1';
const DIR_DADOS = process.env.FORTCRM_DIR ?? join(AQUI, 'data', 'instancias');

/*
 * Uma instância por empresa, mais a central.
 *
 * A carga roda na subida de cada instância que ainda não existe. Isso mantém a
 * promessa de `node server.mjs` funcionar num notebook sem preparo — e, com a
 * federação, significa que acrescentar empresa é acrescentar linha no catálogo,
 * não rodar migração à mão em três bancos.
 */
const fed = new Federacao(DIR_DADOS);
const cargas = CATALOGO.map((e) => ({ ...e, ...semear(fed.abrir(e.codigo), { empresa: e.codigo }) }));

/*
 * Converte para hash qualquer senha que ainda esteja em texto claro — bancos
 * criados antes desta mudança. Roda na subida, e não no primeiro login de cada
 * um: migrar no login deixaria em claro, por tempo indefinido, a senha de quem
 * não entrasse, e são justamente as contas esquecidas que ninguém audita.
 */
const senhas = CATALOGO.map((e) => ({ codigo: e.codigo, ...migrarSenhas(fed.abrir(e.codigo)) }))
  .filter((r) => r.migradas > 0);
fed.abrirCentral();
const consolidacao = sincronizarCentral(fed);
// Uma chave de captação por empresa, criada uma vez e preservada: ela vai
// colada no HTML do site do cliente, e regenerá-la a cada subida quebraria
// todo formulário publicado sem erro nenhum aparecer.
const chaves = garantirChaves(fed.abrirCentral(), CATALOGO);

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** Casa `GET /api/clientes/:id` com o caminho pedido e extrai os parâmetros. */
function casar(padrao, metodo, caminho) {
  const [m, molde] = padrao.split(' ');
  if (m !== metodo) return null;
  const a = molde.split('/').filter(Boolean);
  const b = caminho.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

async function lerCorpo(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return null;
  const pedacos = [];
  let bytes = 0;
  for await (const p of req) {
    bytes += p.length;
    if (bytes > 1024 * 1024) throw new ErroHttp(413, 'corpo_grande', 'Corpo acima de 1 MB.');
    pedacos.push(p);
  }
  if (!pedacos.length) return null;

  /*
   * Os bytes exatos ficam pendurados no `req`.
   *
   * A assinatura do webhook da Meta (`X-Hub-Signature-256`) é um HMAC sobre o
   * corpo BRUTO. Recalcular a partir de `JSON.stringify` do objeto já parseado
   * muda ordem de chaves e espaçamento — a assinatura nunca bate, e o sintoma
   * é "o webhook parou de funcionar" sem nada no log explicar por quê.
   *
   * Pendurar no `req` em vez de mudar o retorno mantém as 40+ rotas existentes
   * intactas: só quem precisa do bruto vai buscá-lo.
   */
  const bruto = Buffer.concat(pedacos);
  req.corpoBruto = bruto;

  try {
    return JSON.parse(bruto.toString('utf8'));
  } catch {
    throw new ErroHttp(400, 'json_invalido', 'Corpo não é JSON válido.');
  }
}

function responder(res, status, dados, tipo = 'application/json; charset=utf-8') {
  const corpo = typeof dados === 'string' ? dados : JSON.stringify(dados);
  res.writeHead(status, {
    'content-type': tipo,
    'content-length': Buffer.byteLength(corpo),
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
  });
  res.end(corpo);
}

async function servirEstatico(res, caminho) {
  const relativo = caminho === '/' ? '/index.html' : caminho;
  // normalize + prefixo travado: impede ../ escapar da pasta web/
  const alvo = join(AQUI, 'web', normalize(relativo).replace(/^([/\\])+/, ''));
  if (!alvo.startsWith(join(AQUI, 'web'))) {
    return responder(res, 403, erro('caminho_invalido', 'Caminho recusado.'));
  }
  try {
    const conteudo = await readFile(alvo);
    res.writeHead(200, {
      'content-type': TIPOS[extname(alvo)] ?? 'application/octet-stream',
      'content-length': conteudo.length,
      'cache-control': 'no-store',
    });
    res.end(conteudo);
  } catch {
    // SPA: qualquer rota desconhecida cai no index.
    if (!extname(alvo)) return servirEstatico(res, '/index.html');
    responder(res, 404, erro('nao_encontrado', 'Arquivo não encontrado.'));
  }
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const caminho = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { allow: 'GET,POST,PATCH,DELETE,OPTIONS' });
    return res.end();
  }

  if (!caminho.startsWith('/api/')) return servirEstatico(res, caminho);

  const limite = consultarLimite(req);
  if (!limite.permitido) {
    res.setHeader('retry-after', String(limite.esperarSegundos));
    return responder(res, 429, erro(
      'limite_excedido',
      `Muitas requisições. Tente de novo em ${limite.esperarSegundos}s.`,
      { max: limite.max, janela: '60s' },
    ));
  }

  try {
    for (const [padrao, mao] of Object.entries(ROTAS_HTML)) {
      const params = casar(padrao, req.method, caminho);
      if (params) {
        const html = await mao(fed, req, params, await lerCorpo(req), url);
        return responder(res, 200, html, 'text/html; charset=utf-8');
      }
    }
    for (const [padrao, mao] of Object.entries(ROTAS)) {
      const params = casar(padrao, req.method, caminho);
      if (params) {
        // A chave da rota casada, para o contexto poder recusar por papel.
        // Vem do PADRÃO (`GET /api/clientes/:id`), não do caminho pedido —
        // senão cada id viraria uma entrada diferente na tabela de permissões.
        req.rotaChave = padrao;
        const corpo = await lerCorpo(req);
        const saida = await mao(fed, req, params, corpo, url);
        // A verificacao do webhook da Meta espera o `hub.challenge` de volta
        // em TEXTO PURO. Devolver JSON faz a Meta recusar o endpoint.
        if (saida && typeof saida === 'object' && '__texto' in saida) {
          return responder(res, 200, saida.__texto, 'text/plain; charset=utf-8');
        }
        return responder(res, 200, saida);
      }
    }
    responder(res, 404, erro('rota_desconhecida', `Sem rota para ${req.method} ${caminho}`));
  } catch (e) {
    if (e instanceof ErroHttp) {
      return responder(res, e.status, erro(e.codigo, e.message, e.detalhe));
    }
    // Nunca vaza stack nem SQL para o cliente; o detalhe fica no log do servidor.
    console.error('[erro]', req.method, caminho, e);
    responder(res, 500, erro('erro_interno', 'Falha ao processar a requisição.'));
  }
});

servidor.listen(PORTA, HOST, () => {
  console.log('');
  console.log('  FORT-CRM — federação de instâncias');
  console.log('  ─────────────────────────────────────────────────────');
  console.log(`  Endereço      http://${HOST}:${PORTA}`);
  console.log(`  Instâncias    ${DIR_DADOS}`);
  console.log(`  DEMO_MODE     ${DEMO_MODE ? 'ligado — nada sai para fora' : 'DESLIGADO'}`);
  console.log('');
  for (const c of cargas) {
    const b = fed.abrir(c.codigo);
    const n = b.sistema().prepare('select count(*) as n from clientes').get().n;
    console.log(`    ${c.codigo}  ${c.nome.padEnd(24)} ${String(n).padStart(3)} clientes`
      + `${c.criado ? '  (carga nova)' : ''}`);
  }
  console.log(`    ${CENTRAL.padEnd(3)} leads consolidados         ${String(consolidacao.linhas).padStart(3)}`);
  console.log('');
  if (senhas.length) {
    console.log(`  Senhas        ${senhas.map((s) => `${s.codigo}:${s.migradas}`).join(' ')} convertidas para hash`);
    console.log('');
  }
  console.log('  Entrar com:   diretoria@fortgrupo.com.br / demo');
  console.log('');
});

// Faxina periódica dos baldes de limite, para o Map não crescer com cada IP.
const faxina = setInterval(() => limparBaldes(), 5 * 60_000);
faxina.unref();

for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    servidor.close(() => {
      fed.fecharTudo();
      process.exit(0);
    });
  });
}
