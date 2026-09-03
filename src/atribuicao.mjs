/**
 * Atribuição de anúncio — o "RG do clique".
 *
 * Este módulo é puro: recebe uma URL (ou um objeto de parâmetros) e devolve o
 * que dá para saber sobre a origem daquele contato. Não toca banco nem rede,
 * o que permite testar as trinta combinações de parâmetro sem subir nada.
 *
 * Duas regras que vêm de dor alheia, não de teoria:
 *
 * PRIMEIRO TOQUE NÃO SE REESCREVE. A pessoa pode clicar em outro anúncio meses
 * depois, numa conversa já aberta. Isso não muda de onde ela veio
 * ORIGINALMENTE, que é o dado que explica a existência do relacionamento. O
 * último toque existe em paralelo, para quem quer medir o que fechou a venda —
 * são perguntas diferentes e merecem colunas diferentes.
 *
 * IDENTIFICADOR DE PESSOA NUNCA VIAJA EM CLARO. O que sai para a plataforma é
 * SHA-256 do valor normalizado. E normalizar não é detalhe: Google e Meta
 * pedem formatos DIFERENTES para o mesmo telefone (uma quer E.164 com `+`, a
 * outra quer só dígitos), e hash de string errada não casa com nada — falha
 * silenciosa, que aparece como "a campanha não converte" três semanas depois.
 */

import { createHash } from 'node:crypto';

/** Parâmetros de clique que as plataformas geram e que precisamos guardar. */
export const PARAMS_CLIQUE = [
  'gclid',   // Google Ads — clique padrão
  'gbraid',  // Google Ads — web-to-app em iOS
  'wbraid',  // Google Ads — app-to-web em iOS
  'fbclid',  // Meta — clique que abre PAGINA
  // Click-to-WhatsApp: o clique que abre a CONVERSA. Nao chega por URL, e sim
  // no `referral` do webhook da primeira mensagem — mas entra aqui porque, do
  // ponto de vista da atribuicao, cumpre o mesmo papel do gclid e do fbclid.
  'ctwa_clid',
];

export const PARAMS_UTM = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
];

function limpo(v) {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
}

/**
 * Extrai a atribuição de uma URL completa ou de um objeto já parseado.
 * Aceita os dois porque a origem varia: no formulário do site vem a URL da
 * página; num webhook de parceiro vem um objeto plano.
 */
export function extrairAtribuicao(entrada, extras = {}) {
  let params = {};

  if (typeof entrada === 'string' && entrada.includes('?')) {
    try {
      params = Object.fromEntries(new URL(entrada, 'https://x.invalid').searchParams);
    } catch {
      params = {};
    }
  } else if (entrada && typeof entrada === 'object') {
    params = entrada;
  }

  const atr = { bruto: { ...params } };
  for (const p of [...PARAMS_CLIQUE, ...PARAMS_UTM]) atr[p] = limpo(params[p]);

  atr.fbp = limpo(params.fbp ?? extras.fbp);
  atr.fbc = limpo(params.fbc ?? extras.fbc) ?? montarFbc(atr.fbclid, extras.cliqueEm);
  atr.pagina_entrada = limpo(extras.paginaEntrada ?? (typeof entrada === 'string' ? entrada : null));
  atr.referrer = limpo(extras.referrer);
  atr.plataforma = inferirPlataforma(atr);

  return atr;
}

/**
 * `fbc` é o cookie de clique da Meta, no formato `fb.1.<ms>.<fbclid>`.
 * Quando o site não tem o Pixel (ou o cookie não veio), a Meta aceita que o
 * servidor monte o valor a partir do `fbclid` da URL — e é isso que faz o
 * evento casar com o anúncio. Sem montar, o `fbclid` sozinho não é lido.
 */
export function montarFbc(fbclid, cliqueEm) {
  if (!fbclid) return null;
  const ms = cliqueEm ? Date.parse(cliqueEm) : Date.now();
  if (!Number.isFinite(ms)) return null;
  return `fb.1.${ms}.${fbclid}`;
}

/**
 * Parâmetro de clique é prova; `utm_source` é declaração. E declaração sozinha
 * não basta: `utm_source=google` com `utm_medium=organic` é busca orgânica, e
 * classificá-la como `google_ads` mandaria conversão ao Google por um lead que
 * nunca clicou em anúncio nenhum. Isso não é só impreciso — é o tipo de erro
 * que ensina o algoritmo com dado falso e distorce a alocação de verba.
 */
const MEDIUM_NAO_PAGO = /^(organic|referral|email|social|none|\(none\)|direct)$/i;

export function inferirPlataforma(atr) {
  if (atr.gclid || atr.gbraid || atr.wbraid) return 'google_ads';
  if (atr.fbclid || atr.fbc || atr.ctwa_clid) return 'meta_ads';

  const fonte = String(atr.utm_source ?? '').toLowerCase();
  const meio = String(atr.utm_medium ?? '').toLowerCase();

  if (meio && MEDIUM_NAO_PAGO.test(meio)) {
    return /indica|referral|parceir/.test(fonte) || meio === 'referral' ? 'indicacao' : 'organico';
  }

  if (/google|gads|adwords/.test(fonte)) return 'google_ads';
  if (/facebook|meta|instagram|ig|fb/.test(fonte)) return 'meta_ads';
  if (/indica|referral|parceir/.test(fonte)) return 'indicacao';
  if (fonte) return 'organico';
  return 'direto';
}

/** Existe alguma coisa aproveitável? Atribuição vazia não merece linha. */
export function temSinal(atr) {
  return Boolean(
    atr.gclid || atr.gbraid || atr.wbraid || atr.fbclid || atr.fbc || atr.ctwa_clid
    || atr.utm_source || atr.utm_campaign || atr.referrer,
  );
}

// ── Normalização e hash ────────────────────────────────────────────────────

export function sha256(valor) {
  const v = String(valor ?? '').trim();
  if (!v) return null;
  return createHash('sha256').update(v).digest('hex');
}

/**
 * E-mail normalizado. O caso especial do Gmail é regra publicada do Google e
 * ignorá-lo custa correspondência: `Joao.Silva+loja@gmail.com` e
 * `joaosilva@gmail.com` são a MESMA caixa, e sem normalizar viram dois hashes
 * diferentes — o mesmo cliente contado como duas pessoas.
 */
export function normalizarEmail(email) {
  const v = String(email ?? '').trim().toLowerCase();
  if (!v.includes('@')) return null;
  const [usuario, dominio] = v.split('@');
  if (!usuario || !dominio) return null;

  if (dominio === 'gmail.com' || dominio === 'googlemail.com') {
    const semRotulo = usuario.split('+')[0].replaceAll('.', '');
    return semRotulo ? `${semRotulo}@gmail.com` : null;
  }
  return `${usuario.split('+')[0]}@${dominio}`;
}

/**
 * Telefone em duas formas, porque as plataformas divergem:
 *   Google Ads pede E.164 COM o `+`  → +5538998112233
 *   Meta CAPI  pede só dígitos       →  5538998112233
 * Hash da forma errada não casa com nada, e a falha é silenciosa.
 */
export function normalizarTelefone(telefone, { paisPadrao = '55' } = {}) {
  const digitos = String(telefone ?? '').replace(/\D/g, '');
  if (digitos.length < 10) return null;

  // Número brasileiro digitado sem DDI (10 ou 11 dígitos) recebe o país.
  const completo = digitos.length <= 11 ? `${paisPadrao}${digitos}` : digitos;
  return { e164: `+${completo}`, digitos: completo };
}

/** Nome/cidade: minúsculas, sem pontuação e sem espaço — regra das duas. */
export function normalizarTexto(v) {
  const s = String(v ?? '')
    .trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
  return s || null;
}

/**
 * Monta o conjunto de identificadores em hash de um contato.
 * Devolve as duas formas de telefone porque quem consome (Google ou Meta)
 * escolhe a sua — decidir aqui qual é "a certa" perderia a outra.
 */
export function identificadoresHash(cliente) {
  const email = normalizarEmail(cliente?.email);
  const fone = normalizarTelefone(cliente?.telefone);
  const partes = String(cliente?.nome ?? '').trim().split(/\s+/);

  return {
    email_sha256: sha256(email),
    fone_sha256: sha256(fone?.e164),          // forma do Google Ads
    fone_digitos_sha256: sha256(fone?.digitos), // forma da Meta
    nome_sha256: sha256(normalizarTexto(partes[0])),
    sobrenome_sha256: partes.length > 1 ? sha256(normalizarTexto(partes.at(-1))) : null,
    cidade_sha256: sha256(normalizarTexto(cliente?.cidade)),
    pais_sha256: sha256('br'),
  };
}

/**
 * Há como identificar esta pessoa para a plataforma?
 *
 * Um parâmetro de clique é a correspondência forte. Os identificadores em hash
 * são a segunda camada, que salva a conversão quando o clique se perdeu (o
 * caso comum: pessoa clica no anúncio, some, e volta dias depois digitando o
 * endereço). Sem nenhum dos dois, enviar é gastar cota para nada.
 */
export function podeCorresponder(atr, hashes) {
  const porClique = Boolean(
    atr?.gclid || atr?.gbraid || atr?.wbraid || atr?.fbc || atr?.fbclid || atr?.ctwa_clid,
  );
  const porPessoa = Boolean(hashes?.email_sha256 || hashes?.fone_sha256 || hashes?.fone_digitos_sha256);
  return {
    pode: porClique || porPessoa,
    porClique,
    porPessoa,
    motivo: porClique || porPessoa ? null : 'sem_identificador',
  };
}
