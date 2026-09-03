/**
 * Serviço de conversão offline — enfileira, avalia e despacha.
 *
 * A cadeia inteira, na ordem em que acontece:
 *
 *   oportunidade muda de etapa
 *     → evento gravado em `event_log`        (nunca efeito externo no gatilho)
 *     → worker drena e enfileira `conversoes` (uma por destino configurado)
 *     → despacho avalia (consentimento, identificador, destino)
 *     → monta o payload real de cada plataforma
 *     → DEMO_MODE: grava a intenção e para; produção: envia
 *
 * Por que passa por `event_log` em vez de enfileirar direto: a mudança de
 * etapa acontece dentro da transação que grava a oportunidade. Enfileirar ali
 * significaria decidir, ainda dentro dela, se há consentimento, se há
 * identificador e quais destinos existem — trabalho que pode falhar e que
 * deixaria a transação de negócio refém de uma regra de marketing.
 */

import { agora, novoId } from './db.mjs';
import {
  EVENTOS, avaliarConversao, chaveIdempotencia, classificarResposta,
  eventoDaEtapa, montarPayload,
} from './conversoes.mjs';
import { DEMO_MODE } from './api-modo.mjs';

/** Grava o evento de mudança de etapa. Barato e sem efeito externo. */
export function registrarMudancaDeEtapa(escopo, { oportunidade, etapaAnterior, ator }) {
  const evento = eventoDaEtapa(oportunidade.etapa);
  if (!evento) return null;

  escopo.inserir('event_log', {
    id: novoId(),
    tipo: 'oportunidade.etapa_mudou',
    entidade: 'oportunidades',
    entidade_id: oportunidade.id,
    payload: JSON.stringify({
      cliente_id: oportunidade.cliente_id,
      etapa: oportunidade.etapa,
      etapa_anterior: etapaAnterior ?? null,
      evento: evento.chave,
      valor_centavos: oportunidade.valor_centavos,
    }),
    metadata: JSON.stringify({ ator }),
    consumido_por: '[]',
    tentativas: 0,
    status: 'pendente',
    proxima_tentativa_em: agora(),
    criado_em: agora(),
  });

  return evento.chave;
}

/**
 * Drena `event_log` e transforma cada mudança de etapa em conversões
 * pendentes — uma por destino configurado e ativo.
 *
 * `consumido_por` guarda a chave de quem já processou. Um evento consumido por
 * este handler não é reprocessado, mesmo que outro handler ainda precise dele:
 * é o que permite acrescentar consumidores depois sem reprocessar o passado.
 */
export const CHAVE_CONSUMIDOR = 'conversoes:enfileirar';

export function drenarEventos(banco, escopo, { limite = 200 } = {}) {
  const eventos = escopo.todas(
    `select * from event_log
     where {ESCOPO} and status = 'pendente' and tipo = 'oportunidade.etapa_mudou'
     order by criado_em asc limit ${Math.min(Number(limite) || 200, 500)}`,
  );

  const destinos = escopo.todas(
    'select * from destinos_conversao where {ESCOPO} and ativo = 1',
  );

  let enfileiradas = 0;
  let ignorados = 0;

  for (const ev of eventos) {
    const consumidores = seguroJson(ev.consumido_por, []);
    if (consumidores.includes(CHAVE_CONSUMIDOR)) { ignorados += 1; continue; }

    const p = seguroJson(ev.payload, {});
    const cliente = escopo.uma('select * from clientes where {ESCOPO} and id = ?', p.cliente_id);

    if (cliente) {
      for (const destino of destinos) {
        const chave = chaveIdempotencia({
          evento: p.evento, clienteId: cliente.id,
          oportunidadeId: ev.entidade_id, destino: destino.destino,
        });

        // O índice único é a garantia real; este SELECT só evita o barulho de
        // uma exceção por linha no caminho normal.
        const existe = escopo.uma(
          'select id from conversoes where {ESCOPO} and idempotency_key = ?', chave,
        );
        if (existe) continue;

        escopo.inserir('conversoes', {
          id: novoId(),
          cliente_id: cliente.id,
          oportunidade_id: ev.entidade_id,
          destino: destino.destino,
          evento: p.evento,
          valor_centavos: p.valor_centavos ?? 0,
          moeda: 'BRL',
          ocorrido_em: ev.criado_em,
          status: 'pendente',
          motivo: null,
          payload: '{}',
          resposta: null,
          idempotency_key: chave,
          criado_em: agora(),
          enviado_em: null,
        });
        enfileiradas += 1;
      }
    }

    consumidores.push(CHAVE_CONSUMIDOR);
    escopo.atualizar('event_log', ev.id, {
      consumido_por: JSON.stringify(consumidores),
      status: 'concluido',
      tentativas: ev.tentativas + 1,
    });
  }

  return { eventos: eventos.length, enfileiradas, ignorados };
}

/**
 * Avalia e despacha as conversões pendentes.
 *
 * Com DEMO_MODE ligado nada sai: o payload é montado, gravado e marcado como
 * enviado-em-simulação. É de propósito que o payload seja montado mesmo assim —
 * é ele que mostra numa reunião exatamente o que iria para o Google e para a
 * Meta, e é ele que denuncia um campo faltando antes de a conta estar ligada.
 */
export function despacharConversoes(banco, escopo, empresa, { limite = 100, ator = 'sistema' } = {}) {
  const pendentes = escopo.todas(
    `select * from conversoes where {ESCOPO} and status = 'pendente'
     order by criado_em asc limit ${Math.min(Number(limite) || 100, 500)}`,
  );

  const destinos = new Map(
    escopo.todas('select * from destinos_conversao where {ESCOPO}').map((d) => [d.destino, d]),
  );

  const resultado = [];

  for (const c of pendentes) {
    const cliente = escopo.uma('select * from clientes where {ESCOPO} and id = ?', c.cliente_id);
    const atribuicao = escopo.uma(
      "select * from atribuicoes where {ESCOPO} and cliente_id = ? and toque = 'primeiro'",
      c.cliente_id,
    );
    const hashes = escopo.uma(
      'select * from identificadores_hash where {ESCOPO} and cliente_id = ?', c.cliente_id,
    );
    const destino = destinos.get(c.destino);

    const decisao = avaliarConversao({
      destinoConfigurado: Boolean(destino?.ativo),
      consentimento: Boolean(cliente?.consentimento_lgpd) && !cliente?.opt_out_em,
      atribuicao,
      hashes,
      evento: c.evento,
      valorCentavos: c.valor_centavos,
      // Sem esta linha a janela de 7 dias virava codigo morto: a funcao so
      // confere a idade quando recebe a data, e o despacho nao passava. Uma
      // conversao que envelheceu na fila seguia para a plataforma e voltava
      // como erro generico de validacao, sem dizer que o problema era a idade.
      ocorridoEm: c.ocorrido_em,
    });

    if (!decisao.permitido) {
      escopo.atualizar('conversoes', c.id, {
        status: 'bloqueado', motivo: decisao.motivo, enviado_em: agora(),
      });
      resultado.push({ id: c.id, status: 'bloqueado', motivo: decisao.motivo });
      continue;
    }

    /*
     * O local da conversao e decidido AQUI, uma vez, e nao dentro de cada
     * montador de payload.
     *
     * `action_source` e vocabulario da Meta — o Offline Conversion Import do
     * Google nao tem campo equivalente. Se a decisao morasse no montador, a
     * coluna ficaria preenchida nas linhas da Meta e vazia nas do Google, e a
     * pergunta de auditoria ("onde voces disseram que esta venda aconteceu?")
     * ficaria sem resposta justamente para metade das conversoes.
     *
     * Conversa aberta por anuncio Click-to-WhatsApp converte no proprio chat;
     * o resto e decisao tomada dentro do CRM enquanto nao houver quem informe
     * o contrario — e `system_generated` e o rotulo que afirma menos.
     */
    const localConversao = atribuicao?.ctwa_clid ? 'business_messaging' : 'system_generated';

    const payload = montarPayload(c.destino, {
      cliente, atribuicao, evento: c.evento,
      valorCentavos: c.valor_centavos, moeda: c.moeda,
      ocorridoEm: c.ocorrido_em, destino, idempotencyKey: c.idempotency_key,
      localConversao,
    });

    // O que a Meta recebeu de fato, quando houve payload de Meta; para o Google
    // vale o local decidido acima. Conferir os dois evita a coluna divergir do
    // que foi realmente enviado.
    const declarado = payload?.corpo?.data?.[0]?.action_source ?? localConversao;

    if (DEMO_MODE) {
      escopo.atualizar('conversoes', c.id, {
        status: 'enviado',
        motivo: 'simulado',
        action_source: declarado,
        payload: JSON.stringify(payload),
        resposta: JSON.stringify({ simulado: true, correspondencia: decisao.correspondencia }),
        enviado_em: agora(),
      });
      resultado.push({
        id: c.id, status: 'enviado', simulado: true, correspondencia: decisao.correspondencia,
      });
    } else {
      // Sem adaptador de rede nesta fatia: gravar `pendente` de volta seria
      // mentir que vai sair sozinho. `desconhecido` é o estado honesto — há
      // intenção registrada e nenhuma confirmação, e ele exige olho humano.
      escopo.atualizar('conversoes', c.id, {
        status: 'desconhecido',
        motivo: 'sem_adaptador_de_rede',
        action_source: declarado,
        payload: JSON.stringify(payload),
        enviado_em: agora(),
      });
      resultado.push({ id: c.id, status: 'desconhecido', motivo: 'sem_adaptador_de_rede' });
    }

    banco.auditar({
      empresaId: empresa.id, ator, acao: 'conversao.despachar',
      entidade: 'conversoes', entidadeId: c.id,
      dados: { destino: c.destino, evento: c.evento, demo: DEMO_MODE },
    });
  }

  return {
    demoMode: DEMO_MODE,
    processadas: resultado.length,
    enviadas: resultado.filter((r) => r.status === 'enviado').length,
    bloqueadas: resultado.filter((r) => r.status === 'bloqueado').length,
    resultado,
  };
}

export { classificarResposta, EVENTOS };

function seguroJson(texto, padrao) {
  try {
    const v = JSON.parse(texto);
    return v ?? padrao;
  } catch {
    return padrao;
  }
}
