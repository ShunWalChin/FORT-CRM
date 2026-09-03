/**
 * Telas de aquisição e da central do grupo.
 *
 * Separadas de `app.js` porque respondem a outra pergunta. As telas de lá são
 * de operação — quem atender, o que entregar. Estas três são de origem e de
 * retorno: de onde o cliente veio, e o que a plataforma de anúncio precisa
 * saber sobre o que aconteceu depois.
 *
 * Recebem `ui` por injeção em vez de importar utilidades de `app.js`. Isso
 * evita o ciclo de importação e deixa explícito o que estas telas usam do
 * resto do sistema — hoje são oito funções, e o dia em que forem trinta a
 * própria assinatura vai denunciar.
 */

export const PLATAFORMAS = {
  google_ads: 'Google Ads',
  meta_ads: 'Meta Ads',
  organico: 'Orgânico',
  indicacao: 'Indicação',
  direto: 'Direto',
  sem_atribuicao: 'Sem atribuição',
};

const DESTINOS = { google_ads: 'Google Ads', meta_capi: 'Meta CAPI' };
const CORES_STATUS = {
  enviado: 'ok', pendente: 'warn', bloqueado: '', desconhecido: 'crit', falhou: 'crit',
};

/* ── Central do grupo ────────────────────────────────────────────────────── */

export function telaCentral(ui) {
  return async (el) => {
    const [resumo, leads] = await Promise.all([
      ui.api('/central/resumo'),
      ui.api('/central/leads'),
    ]);

    const { esc, moeda, numero, data } = ui;
    const pct = resumo.total ? Math.round((resumo.comConsentimento / resumo.total) * 100) : 0;

    el.innerHTML = `
      <div class="cabeca">
        <div>
          <div class="kicker">// INSTÂNCIA CENTRAL</div>
          <h1 class="titulo">Central do grupo</h1>
          <p class="chamada">
            Todo lead de toda empresa, num lugar só. As instâncias continuam separadas e
            continuam sendo a fonte de verdade — aqui é uma <strong>projeção de leitura</strong>,
            atualizada por sincronização. Se a central discordar de uma instância, a instância
            está certa e a central está velha.
          </p>
        </div>
        <button class="btn" id="sincronizar">Sincronizar agora</button>
      </div>

      <div class="aviso">
        Última sincronização: <strong>${resumo.ultimaSincronizacao ? ui.dataHora(resumo.ultimaSincronizacao) : 'nunca'}</strong>.
        Nada é criado nem editado aqui — a central é ponto de chegada e de leitura, não lugar de trabalho.
      </div>

      <div class="grade g4">
        <div class="cartao kpi acento">
          <div class="r">LEADS NO GRUPO</div>
          <div class="v ac">${numero(resumo.total)}</div>
          <div class="n">${numero(resumo.porInstancia.length)} instâncias</div>
        </div>
        <div class="cartao kpi">
          <div class="r">COM CONSENTIMENTO</div>
          <div class="v ${pct >= 90 ? 'ok' : pct >= 70 ? 'warn' : 'crit'}">${pct}%</div>
          <div class="medidor"><i class="${pct >= 90 ? '' : pct >= 70 ? 'warn' : 'crit'}" style="width:${pct}%"></i></div>
        </div>
        <div class="cartao kpi">
          <div class="r">VINDOS DE ANÚNCIO</div>
          <div class="v">${numero(
    resumo.porPlataforma
      .filter((p) => p.plataforma === 'google_ads' || p.plataforma === 'meta_ads')
      .reduce((t, p) => t + p.n, 0),
  )}</div>
          <div class="n">com parâmetro de clique guardado</div>
        </div>
        <div class="cartao kpi">
          <div class="r">GANHO ACUMULADO</div>
          <div class="v">${moeda(resumo.porInstancia.reduce((t, i) => t + (i.ganho ?? 0), 0))}</div>
        </div>
      </div>

      <h2 class="secao">Por instância</h2>
      <div class="grade g3">
        ${resumo.porInstancia.map((i) => `
          <div class="cartao kpi">
            <div class="r">${esc(i.instancia)} · ${esc(String(i.nicho ?? '').toUpperCase())}</div>
            <div class="v" style="font-size:22px">${numero(i.n)}</div>
            <div class="n">${esc(i.empresa_nome)} · ${moeda(i.ganho)} ganho</div>
          </div>`).join('')}
      </div>

      <h2 class="secao">Por plataforma de origem</h2>
      <div class="tabela-caixa"><table>
        <thead><tr><th>Plataforma</th><th class="num">Leads</th><th class="num">Ganho</th><th>Participação</th></tr></thead>
        <tbody>${resumo.porPlataforma.map((p) => {
    const share = resumo.total ? Math.round((p.n / resumo.total) * 100) : 0;
    return `<tr>
            <td class="forte">${esc(PLATAFORMAS[p.plataforma] ?? p.plataforma)}</td>
            <td class="num">${numero(p.n)}</td>
            <td class="num">${moeda(p.ganho)}</td>
            <td style="min-width:130px"><div class="medidor"><i style="width:${share}%"></i></div>
              <span class="fraco">${share}%</span></td>
          </tr>`;
  }).join('')}
        </tbody></table></div>

      <h2 class="secao">Leads consolidados</h2>
      <div class="barra-busca">
        <input id="q-central" placeholder="Buscar em todas as instâncias…">
        <select id="f-instancia">
          <option value="">Todas as instâncias</option>
          ${resumo.porInstancia.map((i) => `<option value="${esc(i.instancia)}">${esc(i.empresa_nome)}</option>`).join('')}
        </select>
        <select id="f-plataforma">
          <option value="">Todas as origens</option>
          ${Object.entries(PLATAFORMAS).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('')}
        </select>
      </div>
      <div id="lista-central">${tabelaLeads(leads, ui)}</div>`;

    const recarregar = async () => {
      const q = el.querySelector('#q-central').value;
      const i = el.querySelector('#f-instancia').value;
      const pl = el.querySelector('#f-plataforma').value;
      const novos = await ui.api(
        `/central/leads?q=${encodeURIComponent(q)}&instancia=${encodeURIComponent(i)}&plataforma=${encodeURIComponent(pl)}`,
      );
      el.querySelector('#lista-central').innerHTML = tabelaLeads(novos, ui);
    };

    let atraso;
    el.querySelector('#q-central').oninput = () => {
      clearTimeout(atraso);
      atraso = setTimeout(recarregar, 220);
    };
    el.querySelector('#f-instancia').onchange = recarregar;
    el.querySelector('#f-plataforma').onchange = recarregar;

    el.querySelector('#sincronizar').onclick = async (ev) => {
      ev.currentTarget.disabled = true;
      ev.currentTarget.textContent = 'Sincronizando…';
      try {
        const r = await ui.api('/central/sincronizar', { method: 'POST' });
        const comErro = r.porInstancia.filter((p) => p.erro);
        ui.toast(
          `${r.linhas} leads sincronizados`,
          comErro.length
            ? `${comErro.length} instância(s) indisponível(is): ${comErro.map((p) => p.instancia).join(', ')}`
            : `${r.porInstancia.length} instâncias, todas responderam.`,
          comErro.length ? 'erro' : '',
        );
        ui.navegar();
      } catch (e) {
        ui.toast('Falha ao sincronizar', e.message, 'erro');
        ev.currentTarget.disabled = false;
        ev.currentTarget.textContent = 'Sincronizar agora';
      }
    };
    void data;
  };
}

function tabelaLeads(leads, ui) {
  const { esc, numero, data, moeda } = ui;
  if (!leads.length) return '<div class="vazio"><h3>Nenhum lead com esses filtros</h3></div>';

  return `<div class="tabela-caixa"><table>
    <thead><tr><th>Instância</th><th>Lead</th><th>Origem</th><th>Campanha</th>
      <th>Etapa</th><th class="num">Ganho</th><th>LGPD</th><th>Entrada</th></tr></thead>
    <tbody>${leads.map((l) => `
      <tr>
        <td><span class="tag ac">${esc(l.instancia)}</span></td>
        <td class="forte">${esc(l.nome)}<div class="fraco">${esc(l.cidade ?? '')}</div></td>
        <td><span class="tag">${esc(PLATAFORMAS[l.plataforma] ?? 'sem atribuição')}</span>
          <div class="fraco">${esc(l.fonte)}</div></td>
        <td class="fraco">${esc(l.utm_campaign ?? '—')}</td>
        <td class="fraco">${esc(l.etapa ?? '—')}</td>
        <td class="num">${l.valor_centavos ? moeda(l.valor_centavos) : '—'}</td>
        <td>${l.consentimento ? '<span class="tag ok">sim</span>' : '<span class="tag warn">não</span>'}</td>
        <td class="fraco">${data(l.criado_em)}</td>
      </tr>`).join('')}
    </tbody></table></div>
    <p class="fraco" style="margin-top:10px">${numero(leads.length)} lead(s) listado(s).</p>`;
}

/* ── Conversões offline ──────────────────────────────────────────────────── */

export function telaConversoes(ui) {
  return async (el) => {
    const d = await ui.api('/conversoes');
    const { esc, moeda, numero, dataHora } = ui;

    el.innerHTML = `
      <div class="cabeca">
        <div>
          <div class="kicker">// CONVERSÃO OFFLINE</div>
          <h1 class="titulo">O que volta para o anúncio</h1>
          <p class="chamada">
            A plataforma de anúncio só enxerga até o formulário enviado. Ela não sabe se aquele
            lead virou orçamento, sumiu ou comprou oito mil reais. Sem esse retorno, o algoritmo
            otimiza para <strong>volume de formulário</strong> — que é exatamente o que enche a
            agenda de curioso e esconde o cliente de frota.
          </p>
        </div>
        <button class="btn" id="processar">Processar fila</button>
      </div>

      ${d.demoMode ? `<div class="aviso warn">
        <strong>DEMO_MODE ligado.</strong> O payload é montado, gravado e auditado — mas nada é
        enviado ao Google nem à Meta. É de propósito que ele seja montado mesmo assim: é o que
        mostra o que sairia, e é o que denuncia um campo faltando antes de a conta estar ligada.
      </div>` : ''}

      <div class="grade g4">
        <div class="cartao kpi ${d.resumo.pendentes ? 'acento' : ''}">
          <div class="r">NA FILA</div>
          <div class="v ${d.resumo.pendentes ? 'ac' : ''}">${numero(d.resumo.pendentes)}</div>
          <div class="n">${numero(d.resumo.eventosPendentes)} evento(s) por drenar</div>
        </div>
        <div class="cartao kpi"><div class="r">ENVIADAS</div><div class="v ok">${numero(d.resumo.enviadas)}</div></div>
        <div class="cartao kpi">
          <div class="r">BLOQUEADAS</div><div class="v">${numero(d.resumo.bloqueadas)}</div>
          <div class="n">compliance recusou</div>
        </div>
        <div class="cartao kpi">
          <div class="r">AMBÍGUAS</div>
          <div class="v ${d.resumo.desconhecidas ? 'crit' : 'ok'}">${numero(d.resumo.desconhecidas)}</div>
          <div class="n">exigem conferência humana</div>
        </div>
      </div>

      <h2 class="secao">Eventos que voltam</h2>
      <div class="grade g3">
        ${d.eventos.map((e) => `
          <div class="cartao">
            <h4>${esc(e.nome)}</h4>
            <p style="font-size:13.5px;color:var(--dim);margin-top:5px">
              Dispara na etapa <strong>${esc(e.etapas.join(', '))}</strong>.
              No Meta vai como <code style="font-family:var(--mono)">${esc(e.nomeMeta)}</code>.
              ${e.exigeValor ? 'Exige valor — sem ele não ensina retorno.' : 'Vale sem valor: o sinal é a qualidade.'}
            </p>
          </div>`).join('')}
      </div>

      <h2 class="secao">Destinos configurados</h2>
      <div class="tabela-caixa"><table>
        <thead><tr><th>Destino</th><th>Identificador</th><th>Ação de conversão</th><th>Estado</th></tr></thead>
        <tbody>${d.destinos.map((x) => `
          <tr><td class="forte">${esc(DESTINOS[x.destino] ?? x.destino)}</td>
            <td style="font-family:var(--mono);font-size:12.5px">${esc(x.identificador)}</td>
            <td class="fraco" style="font-family:var(--mono);font-size:11.5px">${esc(x.acao ?? '—')}</td>
            <td>${x.ativo ? '<span class="tag ok">ativo</span>' : '<span class="tag">desligado</span>'}</td></tr>`).join('')}
        </tbody></table></div>

      <h2 class="secao">Fila</h2>
      ${d.linhas.length ? `<div class="tabela-caixa"><table>
        <thead><tr><th>Quando</th><th>Cliente</th><th>Evento</th><th>Destino</th>
          <th class="num">Valor</th><th>Status</th><th></th></tr></thead>
        <tbody>${d.linhas.map((l) => `
          <tr>
            <td class="fraco">${dataHora(l.criado_em)}</td>
            <td class="forte">${esc(l.cliente_nome)}<div class="fraco">${esc(l.oportunidade_titulo ?? '')}</div></td>
            <td>${esc(l.evento)}</td>
            <td class="fraco">${esc(DESTINOS[l.destino] ?? l.destino)}</td>
            <td class="num">${l.valor_centavos ? moeda(l.valor_centavos) : '—'}</td>
            <td><span class="tag ${CORES_STATUS[l.status] ?? ''}">${esc(l.status)}</span>
              ${l.motivo ? `<div class="fraco">${esc(l.motivo)}</div>` : ''}</td>
            <td>${l.payload && l.payload !== '{}'
    ? `<button class="btn quiet sm" data-payload="${esc(l.id)}">Ver payload</button>` : ''}</td>
          </tr>`).join('')}
        </tbody></table></div>`
    : `<div class="vazio"><div class="ic">↺</div><h3>Nada na fila</h3>
         <p>Mova uma oportunidade para Qualificado, Orçamento ou Ganho no pipeline
            e volte aqui — o evento aparece para ser processado.</p></div>`}`;

    el.querySelector('#processar').onclick = async (ev) => {
      ev.currentTarget.disabled = true;
      ev.currentTarget.textContent = 'Processando…';
      try {
        const r = await ui.api('/conversoes/processar', { method: 'POST' });
        ui.toast(
          `${r.despacho.enviadas} conversão(ões) despachada(s)`,
          `${r.drenagem.enfileiradas} enfileiradas · ${r.despacho.bloqueadas} bloqueadas pelo compliance`
          + `${r.despacho.demoMode ? ' · DEMO_MODE: nada saiu de verdade' : ''}`,
        );
        ui.navegar();
      } catch (e) {
        ui.toast('Falha ao processar', e.message, 'erro');
        ev.currentTarget.disabled = false;
        ev.currentTarget.textContent = 'Processar fila';
      }
    };

    el.querySelectorAll('[data-payload]').forEach((b) => {
      b.onclick = () => abrirPayload(ui, b.dataset.payload);
    });
  };
}

async function abrirPayload(ui, id) {
  ui.abrirGaveta('<div class="carregando">carregando payload…</div>');
  const d = await ui.api(`/conversoes/${id}`);
  const { esc, moeda } = ui;

  ui.abrirGaveta(`
    <div class="gaveta-topo">
      <div>
        <div class="kicker">// PAYLOAD REAL</div>
        <h2>${esc(DESTINOS[d.conversao.destino] ?? d.conversao.destino)}</h2>
        <div style="margin-top:8px;display:flex;gap:7px;flex-wrap:wrap">
          <span class="tag ${CORES_STATUS[d.conversao.status] ?? ''}">${esc(d.conversao.status)}</span>
          <span class="tag">${esc(d.conversao.evento)}</span>
          ${d.conversao.valor_centavos ? `<span class="tag ac">${moeda(d.conversao.valor_centavos)}</span>` : ''}
        </div>
      </div>
      <button class="fechar" data-fechar>fechar</button>
    </div>

    <div class="aviso" style="margin-top:18px">
      É exatamente isto que sairia para a plataforma. Nenhum e-mail nem telefone viaja em claro:
      o que vai é SHA-256 do valor normalizado — e Google e Meta pedem o telefone em formatos
      <strong>diferentes</strong>, um com <code style="font-family:var(--mono)">+</code> e outro sem.
    </div>

    <dl style="margin-top:6px">
      <div class="par"><dt>Cliente</dt><dd>${esc(d.cliente?.nome ?? '—')}</dd></div>
      <div class="par"><dt>Endpoint</dt><dd style="font-family:var(--mono);font-size:12px">${esc(d.payload?.endpoint ?? '—')}</dd></div>
      <div class="par"><dt>Chave de idempotência</dt><dd style="font-family:var(--mono);font-size:11.5px">${esc(d.conversao.idempotency_key)}</dd></div>
      <div class="par"><dt>Atribuição</dt><dd>${esc(PLATAFORMAS[d.atribuicao?.plataforma] ?? 'sem atribuição')}</dd></div>
      <div class="par"><dt>Parâmetro de clique</dt><dd style="font-family:var(--mono);font-size:11.5px">${esc(d.atribuicao?.gclid ?? d.atribuicao?.fbclid ?? '—')}</dd></div>
    </dl>

    <h2 class="secao">Corpo da requisição</h2>
    <pre class="mensagem" style="white-space:pre;overflow-x:auto">${esc(JSON.stringify(d.payload?.corpo ?? {}, null, 2))}</pre>`);
}

/* ── Origem dos leads ────────────────────────────────────────────────────── */

export function telaAtribuicao(ui) {
  return async (el) => {
    const d = await ui.api('/atribuicao');
    const { esc, numero, data } = ui;
    const total = d.linhas.length;

    el.innerHTML = `
      <div class="cabeca"><div>
        <div class="kicker">// AQUISIÇÃO</div>
        <h1 class="titulo">De onde o cliente veio</h1>
        <p class="chamada">
          O parâmetro de clique é o RG do anúncio: sem ele guardado no momento da entrada,
          não há como devolver a conversão depois. É <strong>primeiro toque</strong> e nunca se
          reescreve — a pessoa pode clicar noutro anúncio meses depois, e isso não muda de onde
          ela veio originalmente.
        </p>
      </div></div>

      <div class="grade g3">
        ${d.porPlataforma.map((p) => `
          <div class="cartao kpi">
            <div class="r">${esc((PLATAFORMAS[p.plataforma] ?? p.plataforma).toUpperCase())}</div>
            <div class="v" style="font-size:24px">${numero(p.n)}</div>
            <div class="n">${total ? Math.round((p.n / total) * 100) : 0}% dos atribuídos</div>
          </div>`).join('')}
      </div>

      <h2 class="secao">Por campanha</h2>
      <div class="tabela-caixa"><table>
        <thead><tr><th>Campanha</th><th class="num">Leads</th></tr></thead>
        <tbody>${d.porCampanha.map((c) => `
          <tr><td class="forte">${esc(c.campanha)}</td><td class="num">${numero(c.n)}</td></tr>`).join('')}
        </tbody></table></div>

      <h2 class="secao">Atribuições registradas</h2>
      ${d.linhas.length ? `<div class="tabela-caixa"><table>
        <thead><tr><th>Cliente</th><th>Plataforma</th><th>Parâmetro de clique</th>
          <th>Campanha</th><th>Origem / meio</th><th>LGPD</th><th>Capturado</th></tr></thead>
        <tbody>${d.linhas.map((l) => `
          <tr>
            <td class="forte">${esc(l.cliente_nome)}</td>
            <td><span class="tag ${l.plataforma === 'google_ads' ? 'ac' : l.plataforma === 'meta_ads' ? 'al' : ''}">${esc(PLATAFORMAS[l.plataforma] ?? l.plataforma)}</span></td>
            <td style="font-family:var(--mono);font-size:11.5px">${esc(recortar(l.gclid ?? l.fbclid ?? l.gbraid ?? l.wbraid))}</td>
            <td class="fraco">${esc(l.utm_campaign ?? '—')}</td>
            <td class="fraco">${esc(l.utm_source ?? '—')} / ${esc(l.utm_medium ?? '—')}</td>
            <td>${l.consentimento_lgpd ? '<span class="tag ok">sim</span>' : '<span class="tag warn">não</span>'}</td>
            <td class="fraco">${data(l.capturado_em)}</td>
          </tr>`).join('')}
        </tbody></table></div>`
    : '<div class="vazio"><h3>Nenhuma atribuição registrada</h3></div>'}

      <div class="aviso" style="margin-top:20px">
        <strong>Sem consentimento, nada volta.</strong> Um lead sem autorização LGPD fica na base
        e no funil, mas a conversão dele é bloqueada antes de sair — mandar hash de e-mail de quem
        não autorizou é tratamento de dado pessoal sem base legal, e o hash não muda isso.
      </div>`;
  };
}

function recortar(v) {
  const s = String(v ?? '');
  if (!s) return '—';
  return s.length > 22 ? `${s.slice(0, 22)}…` : s;
}
