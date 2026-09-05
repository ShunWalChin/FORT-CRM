/**
 * Nome da campanha por trás do `source_ad_id`.
 *
 * O ponto cego que este módulo fecha: um lead que chega por Click-to-WhatsApp
 * **não tem UTM**. Não houve navegador, não houve página, não houve query
 * string — o anúncio abriu a conversa direto. O que chega no webhook é
 * `source_ad_id` e `ctwa_clid`, e mais nada.
 *
 * A tela "Origem dos leads" agrupava por `utm_campaign`. Resultado: todo lead
 * de Click-to-WhatsApp caía em `sem_campanha`, e a pergunta que paga o
 * anúncio — *qual campanha trouxe estas quinze pessoas?* — não tinha resposta
 * justamente para o canal em que a empresa gasta dinheiro.
 *
 * Aqui o `ad_id` vira nome de campanha, de conjunto e de anúncio, lidos da
 * Graph API e guardados. Três decisões que valem estar escritas:
 *
 *   1. **Nunca inventar nome.** Sem token, sem rede ou com erro da Meta, a
 *      tela mostra o id cru e diz por que não resolveu. Um "Campanha 123456"
 *      fabricado seria pior que o id: parece resposta.
 *
 *   2. **Resolver nunca acontece no caminho da tela.** `GET /api/atribuicao`
 *      lê só o que já está guardado. Buscar na Graph API durante a renderização
 *      deixaria a tela refém da latência da Meta — e de um token vencido.
 *
 *   3. **Ler não é enviar.** Resolver nome é uma leitura da conta de anúncios
 *      da própria empresa: não gasta verba, não conta conversão, não muda
 *      entrega. Por isso não depende de `DEMO_MODE` — depende de haver token,
 *      que só existe onde alguém configurou de propósito.
 */

import { agora, novoId } from './db.mjs';

/**
 * Versão da Graph API, fixada em um lugar só.
 *
 * Versão não declarada faz a Meta escolher a mais antiga ainda viva, e o
 * formato muda debaixo do código sem aviso.
 */
export const VERSAO_GRAPH = 'v21.0';

/** Campos pedidos numa chamada só — três viagens por anúncio seria absurdo. */
export const CAMPOS_ANUNCIO = 'name,adset{id,name},campaign{id,name},effective_status';

/**
 * Nome de campanha muda: gente renomeia anúncio no meio da veiculação. Sete
 * dias é o meio-termo entre um cache que mente e uma conta de API por página.
 */
export const VALIDADE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Falha também é guardada, com espera.
 *
 * Sem isto, um `ad_id` apagado no Gerenciador — que nunca vai resolver — seria
 * tentado de novo a cada clique em "Resolver nomes", e cada tentativa custa
 * uma chamada de API contra o limite da conta.
 */
export const ESPERA_APOS_FALHA_MS = 6 * 60 * 60 * 1000;

/** Quantos anúncios uma execução tenta. Teto para não varrer a conta inteira. */
export const LOTE_MAXIMO = 25;

/** Precisa ir à Graph API? */
export function precisaResolver(dim, agoraMs = Date.now()) {
  if (!dim) return true;
  if (dim.resolvido_em) {
    return agoraMs - new Date(dim.resolvido_em).getTime() > VALIDADE_MS;
  }
  if (dim.tentado_em) {
    return agoraMs - new Date(dim.tentado_em).getTime() > ESPERA_APOS_FALHA_MS;
  }
  return true;
}

/**
 * O token vai no cabeçalho, e não na query string.
 *
 * `?access_token=...` acaba em log de proxy, em histórico e no `Referer`. É a
 * forma que a documentação da Meta mostra primeiro e a que não se deve usar.
 */
export function requisicaoDoAnuncio(adId, token) {
  return {
    url: `https://graph.facebook.com/${VERSAO_GRAPH}/${encodeURIComponent(adId)}`
      + `?fields=${encodeURIComponent(CAMPOS_ANUNCIO)}`,
    opcoes: { headers: { authorization: `Bearer ${token}` } },
  };
}

/**
 * Extrai o que interessa da resposta da Graph API.
 *
 * Tolerante de propósito: um anúncio sem conjunto (raro, mas acontece com
 * criativo em rascunho) ainda tem nome de campanha, e perder os dois porque um
 * faltou seria trocar dado parcial por dado nenhum.
 */
export function lerAnuncio(json) {
  if (!json || typeof json !== 'object') return null;
  const nome = json.name ?? null;
  const camp = json.campaign ?? {};
  const conj = json.adset ?? {};
  if (!nome && !camp.name && !conj.name) return null;
  return {
    anuncio_nome: nome,
    campanha_id: camp.id ?? null,
    campanha_nome: camp.name ?? null,
    conjunto_id: conj.id ?? null,
    conjunto_nome: conj.name ?? null,
    situacao: json.effective_status ?? null,
  };
}

/**
 * Mensagem de erro legível a partir da resposta da Meta.
 *
 * O que a tela precisa saber é se o problema é do TOKEN (some para todo mundo
 * ao renovar) ou do ANÚNCIO (aquele id específico sumiu). São dois consertos
 * diferentes, e "erro ao resolver" não distingue.
 */
export function diagnosticarErro(status, json) {
  const err = json?.error ?? {};
  const cod = err.code ?? null;
  if (status === 401 || cod === 190) {
    return { causa: 'token_invalido', texto: 'O token de marketing venceu ou foi revogado.' };
  }
  if (cod === 4 || cod === 17 || cod === 613 || status === 429) {
    return { causa: 'limite_api', texto: 'A Meta recusou por limite de chamadas. Tente mais tarde.' };
  }
  if (status === 403 || cod === 200 || cod === 10) {
    return {
      causa: 'sem_permissao',
      texto: 'O token não tem permissão de leitura nesta conta de anúncios (falta ads_read).',
    };
  }
  if (status === 404 || cod === 803) {
    return { causa: 'anuncio_inexistente', texto: 'Este anúncio não existe mais no Gerenciador.' };
  }
  return {
    causa: 'erro_meta',
    texto: err.message ? String(err.message).slice(0, 200) : `A Meta respondeu HTTP ${status}.`,
  };
}

/**
 * Resolve uma lista de `ad_id` e grava o resultado.
 *
 * `buscar` é injetado para que o teste não toque a rede — e para que a única
 * chamada externa do sistema tenha um ponto de costura visível, em vez de um
 * `fetch` solto no meio da regra.
 */
export async function resolverAnuncios(escopo, ids, {
  token, buscar = fetch, agoraMs = Date.now(), limite = LOTE_MAXIMO,
} = {}) {
  const alvo = [...new Set(ids.filter(Boolean).map(String))].slice(0, limite);
  const saida = { resolvidos: 0, falhas: 0, pulados: 0, detalhes: [] };

  if (!token) {
    return { ...saida, semToken: true, pulados: alvo.length };
  }

  for (const adId of alvo) {
    const dim = escopo.uma(
      'select * from dimensoes_campanha where {ESCOPO} and source_ad_id = ?', adId,
    );
    if (!precisaResolver(dim, agoraMs)) { saida.pulados += 1; continue; }

    const { url, opcoes } = requisicaoDoAnuncio(adId, token);
    let campos = null;
    let erro = null;

    try {
      const r = await buscar(url, opcoes);
      const json = await r.json().catch(() => ({}));
      if (r.ok) {
        campos = lerAnuncio(json);
        if (!campos) erro = { causa: 'resposta_vazia', texto: 'A Meta respondeu sem nome nenhum.' };
      } else {
        erro = diagnosticarErro(r.status, json);
      }
    } catch (e) {
      // Rede caída não é "anúncio inexistente". Guardar a distinção evita que
      // uma queda de minutos vire "essas campanhas não existem" na tela.
      erro = { causa: 'rede', texto: e?.message ? String(e.message).slice(0, 200) : 'Falha de rede.' };
    }

    // `empresa_id` NAO entra aqui: quem carimba o tenant e o proprio escopo,
    // e passar pelo corpo abriria a porta que `inserir()` existe para fechar.
    const base = {
      source_ad_id: adId,
      tentado_em: new Date(agoraMs).toISOString(),
    };

    if (campos) {
      gravarDimensao(escopo, {
        ...base, ...campos, resolvido_em: new Date(agoraMs).toISOString(), erro: null, erro_causa: null,
      });
      saida.resolvidos += 1;
      saida.detalhes.push({ adId, ok: true, campanha: campos.campanha_nome });
    } else {
      /*
       * A falha NÃO apaga o que já estava resolvido.
       *
       * Token vencido não deve transformar seis meses de nomes de campanha em
       * ids crus — a tela ficaria pior do que antes de existir este módulo.
       */
      gravarDimensao(escopo, {
        ...base,
        ...(dim ? {} : { anuncio_nome: null, campanha_nome: null, conjunto_nome: null }),
        erro: erro.texto,
        erro_causa: erro.causa,
      });
      saida.falhas += 1;
      saida.detalhes.push({ adId, ok: false, causa: erro.causa, texto: erro.texto });
    }
  }

  return saida;
}

/** Insere ou atualiza a linha da dimensão, preservando o que não veio. */
function gravarDimensao(escopo, dados) {
  const existe = escopo.uma(
    'select id from dimensoes_campanha where {ESCOPO} and source_ad_id = ?',
    dados.source_ad_id,
  );
  const linha = { ...dados, atualizado_em: agora() };
  if (existe) escopo.atualizar('dimensoes_campanha', existe.id, linha);
  else escopo.inserir('dimensoes_campanha', { id: novoId(), ...linha });
}

/**
 * Como a campanha aparece na tela.
 *
 * Devolve sempre alguma coisa, e sempre diz o que é: nome real quando existe,
 * o id cru com o motivo quando não. Nunca um nome fabricado.
 */
export function rotularCampanha(dim, adId) {
  if (!adId) return { rotulo: 'Sem anúncio', resolvido: null, id: null };
  if (dim?.campanha_nome) {
    return {
      rotulo: dim.campanha_nome,
      conjunto: dim.conjunto_nome ?? null,
      anuncio: dim.anuncio_nome ?? null,
      situacao: dim.situacao ?? null,
      resolvido: true,
      id: adId,
    };
  }
  return {
    rotulo: `Anúncio ${adId}`,
    resolvido: false,
    id: adId,
    porque: dim?.erro ?? 'Ainda não resolvido — falta rodar "Resolver nomes".',
    causa: dim?.erro_causa ?? 'nao_tentado',
  };
}
