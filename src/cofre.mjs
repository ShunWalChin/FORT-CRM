/**
 * Cofre de credenciais: segredo de integração cifrado em repouso.
 *
 * O problema que ele resolve não é criptografia por criptografia — é que
 * **variável de ambiente é uma só, e as empresas são três**.
 *
 * `FORTCRM_META_MARKETING_TOKEN` serve a um único conjunto de anúncios. A Minas
 * Peças, a Agrofort e a Fort Tintas têm contas de anúncio diferentes, WABAs
 * diferentes e, muitas vezes, agências diferentes. Com uma variável de processo,
 * resolver o nome das campanhas só funcionava para uma delas — e em silêncio,
 * porque a Graph API simplesmente responde "não encontrado" para o anúncio da
 * conta errada.
 *
 * Aqui cada credencial vive **no banco da própria empresa**, atrás do mesmo
 * `empresa_id` que separa clientes e pedidos. O isolamento que já existe passa a
 * valer também para o segredo.
 *
 * A cifra (AES-256-GCM) cobre o caso concreto do backup: `VACUUM INTO` produz um
 * arquivo que sai da máquina. Sem isto, o token da Meta viajaria em claro dentro
 * dele. Não protege contra quem já está dentro do processo — nada protege — e a
 * chave-mestra continua sendo o segredo a guardar.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGORITMO = 'aes-256-gcm';

/**
 * IV de 12 bytes é o recomendado para GCM: é o tamanho que o modo usa
 * diretamente, sem passar pela derivação GHASH que os outros tamanhos exigem.
 */
const TAM_IV = 12;

/** Credenciais que o sistema conhece. Chave desconhecida é recusada. */
export const CREDENCIAIS = {
  meta_marketing_token: {
    nome: 'Token de marketing da Meta',
    para: 'Ler o nome das campanhas por trás do ad_id (permissão ads_read).',
    ambiente: 'FORTCRM_META_MARKETING_TOKEN',
  },
  meta_capi_token: {
    nome: 'Token de conversões da Meta',
    para: 'Enviar conversão offline pela Conversions API (permissão manage_events).',
    ambiente: 'FORTCRM_META_CAPI_TOKEN',
  },
  meta_dataset_id: {
    nome: 'Dataset (pixel) da Meta',
    para: 'Para onde a conversão é enviada.',
    ambiente: 'FORTCRM_META_DATASET_ID',
    // Não é segredo — é identificador. Fica em claro para poder ser conferido
    // na tela sem descriptografar nada, que é o uso real dele.
    publico: true,
  },
};

/**
 * Chave-mestra de 32 bytes.
 *
 * **Falta de chave falha alto, e não silenciosamente.**
 *
 * A referência de onde este desenho veio deriva uma chave de uma semente fixa
 * no código quando a variável falta. O efeito é que "cifrado em repouso" passa a
 * ser decifrável por qualquer um que leia o repositório — e ninguém é avisado,
 * porque tudo continua funcionando. Um cofre que se abre sozinho é pior que
 * nenhum cofre, porque ele convence quem o usa de que há proteção.
 */
export function chaveMestra(env = process.env) {
  const bruta = env.FORTCRM_CHAVE_MESTRA;
  if (!bruta) {
    throw new Error(
      'FORTCRM_CHAVE_MESTRA ausente. Gere com `openssl rand -hex 32` e guarde em '
      + '/etc/fortcrm.env (0600, root). Sem ela não há como cifrar nem decifrar credencial.',
    );
  }
  if (/^[0-9a-fA-F]{64}$/.test(bruta)) return Buffer.from(bruta, 'hex');

  /*
   * Passphrase também é aceita, mas derivada — e o SHA-256 aqui NÃO é
   * alongamento de senha: quem escolhe uma frase curta continua com uma frase
   * curta. A recomendação (e o que o deploy gera) são os 64 hex.
   */
  if (bruta.length < 24) {
    throw new Error('FORTCRM_CHAVE_MESTRA curta demais: use 64 hex, ou ao menos 24 caracteres.');
  }
  return createHash('sha256').update(bruta).digest();
}

/** Há chave configurada? Para a tela poder dizer o que falta antes de tentar. */
export function temChave(env = process.env) {
  try { chaveMestra(env); return true; } catch { return false; }
}

/** Cifra um texto. Devolve as três partes que a decifragem exige. */
export function cifrar(texto, env = process.env) {
  const valor = String(texto ?? '');
  if (!valor) throw new Error('nada a cifrar');

  const iv = randomBytes(TAM_IV);
  const c = createCipheriv(ALGORITMO, chaveMestra(env), iv);
  const conteudo = Buffer.concat([c.update(valor, 'utf8'), c.final()]).toString('hex');
  return { conteudo, iv: iv.toString('hex'), tag: c.getAuthTag().toString('hex') };
}

/**
 * Decifra. A tag de autenticação é conferida pelo próprio GCM: conteúdo
 * adulterado no banco não devolve lixo — lança.
 */
export function decifrar({ conteudo, iv, tag } = {}, env = process.env) {
  if (!conteudo || !iv || !tag) throw new Error('credencial incompleta: falta conteudo, iv ou tag');
  const d = createDecipheriv(ALGORITMO, chaveMestra(env), Buffer.from(iv, 'hex'));
  d.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([d.update(Buffer.from(conteudo, 'hex')), d.final()]).toString('utf8');
}

/**
 * Como o segredo aparece na tela: os últimos quatro caracteres, e mais nada.
 *
 * O suficiente para alguém conferir se o token que está lá é o que ele acabou
 * de colar do Gerenciador da Meta, e insuficiente para reconstruir qualquer
 * coisa. Segredo curto demais não mostra nem isso.
 */
export function pista(valor) {
  const s = String(valor ?? '');
  if (s.length < 12) return '••••';
  return `••••${s.slice(-4)}`;
}

/**
 * Lê uma credencial da empresa, caindo para a variável de ambiente.
 *
 * A ordem importa e é esta: **o que a empresa configurou vence o ambiente**. A
 * variável continua existindo como piso — instalação de uma empresa só, ou o
 * período entre subir o sistema e alguém abrir a tela — mas quem tem três
 * contas de anúncio precisa que a da instância mande.
 *
 * Nunca lança: credencial ilegível (chave trocada, linha adulterada) devolve
 * `null` com o motivo, porque quem chama quer saber se pode agir, e não receber
 * uma exceção no meio da tela.
 */
export function lerCredencial(escopo, chave, env = process.env) {
  const def = CREDENCIAIS[chave];
  if (!def) return { valor: null, origem: 'desconhecida', erro: `credencial desconhecida: ${chave}` };

  let linha = null;
  try {
    linha = escopo.uma('select * from credenciais where {ESCOPO} and chave = ?', chave);
  } catch {
    // Tabela ainda não migrada numa instância antiga não pode derrubar quem lê.
    linha = null;
  }

  if (linha) {
    if (def.publico) return { valor: linha.valor_claro ?? null, origem: 'instancia' };
    try {
      return {
        valor: decifrar({ conteudo: linha.conteudo, iv: linha.iv, tag: linha.tag }, env),
        origem: 'instancia',
      };
    } catch (e) {
      return {
        valor: null,
        origem: 'instancia',
        erro: e.message.includes('CHAVE_MESTRA')
          ? 'A chave-mestra não está configurada neste servidor.'
          : 'A credencial guardada não abre com a chave-mestra atual — ela foi trocada?',
      };
    }
  }

  const doAmbiente = env[def.ambiente];
  if (doAmbiente) return { valor: doAmbiente, origem: 'ambiente' };
  return { valor: null, origem: 'nenhuma' };
}

/** Grava (ou substitui) a credencial da empresa. Devolve só a pista. */
export function gravarCredencial(escopo, chave, valor, { ator, agoraIso, novoId, env = process.env }) {
  const def = CREDENCIAIS[chave];
  if (!def) throw new Error(`credencial desconhecida: ${chave}`);

  const texto = String(valor ?? '').trim();
  if (!texto) throw new Error('valor vazio');

  const partes = def.publico
    ? { valor_claro: texto, conteudo: null, iv: null, tag: null }
    : { valor_claro: null, ...cifrar(texto, env) };

  const existe = escopo.uma('select id from credenciais where {ESCOPO} and chave = ?', chave);
  const linha = {
    chave,
    ...partes,
    pista: pista(texto),
    atualizado_por: ator,
    atualizado_em: agoraIso,
  };
  if (existe) escopo.atualizar('credenciais', existe.id, linha);
  else escopo.inserir('credenciais', { id: novoId(), ...linha });

  return { chave, pista: linha.pista };
}

/** Apaga a credencial da empresa. O sistema volta a cair no ambiente, se houver. */
export function apagarCredencial(escopo, chave) {
  const existe = escopo.uma('select id from credenciais where {ESCOPO} and chave = ?', chave);
  if (!existe) return false;
  escopo.remover('credenciais', existe.id);
  return true;
}

/**
 * O que a tela pode ver: o que existe, de onde veio e a pista. Nunca o valor.
 *
 * Devolver o segredo para o navegador — ainda que só para quem é soberano —
 * o espalharia por cache, histórico e extensão. Quem precisa do valor é o
 * servidor, e ele já o tem.
 */
export function listarCredenciais(escopo, env = process.env) {
  return Object.entries(CREDENCIAIS).map(([chave, def]) => {
    const r = lerCredencial(escopo, chave, env);
    let linha = null;
    try {
      linha = escopo.uma('select pista, atualizado_em, atualizado_por from credenciais where {ESCOPO} and chave = ?', chave);
    } catch { /* tabela ausente em instância antiga */ }
    return {
      chave,
      nome: def.nome,
      para: def.para,
      ambiente: def.ambiente,
      publico: !!def.publico,
      definida: !!r.valor,
      origem: r.origem,
      erro: r.erro ?? null,
      pista: def.publico ? (r.valor ?? null) : (linha?.pista ?? (r.origem === 'ambiente' ? pista(r.valor) : null)),
      atualizadoEm: linha?.atualizado_em ?? null,
      atualizadoPor: linha?.atualizado_por ?? null,
    };
  });
}
