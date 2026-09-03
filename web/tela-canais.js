/**
 * Canais de entrada.
 *
 * Existe porque a pergunta "de onde vêm nossos leads?" não tinha resposta no
 * sistema — e a resposta que a base dava estava errada: as três empresas
 * compartilhavam a mesma lista de origens, com canais de oficina de injeção
 * aparecendo na fazenda de queijo e na loja de tintas.
 *
 * A tela mostra três coisas, nesta ordem de importância:
 *
 *   1. quanto da base é ATRIBUÍVEL — a conta que decide se faz sentido ligar
 *      conversão offline. Cobertura de 20% significa que 80% do faturamento é
 *      invisível para o anúncio que o gerou;
 *   2. quais canais ainda não têm porta ligada — cada um é lead entrando na
 *      mão de alguém, ou não entrando;
 *   3. a chave e o formulário prontos para colar no site do cliente. Sem isso
 *      a porta pública existe no código e não existe na prática.
 */

const ROTULO_ENTRADA = {
  webhook: { nome: 'Porta pública', tag: 'ok', nota: 'Entra sozinho, com atribuição.' },
  manual: { nome: 'Digitado', tag: '', nota: 'Alguém precisa cadastrar.' },
  integracao: { nome: 'Falta conector', tag: 'warn', nota: 'Precisa de integração que ainda não existe.' },
};

export function telaCanais(ui) {
  return async (el) => {
    const d = await ui.api('/canais');
    const { esc, numero, toast } = ui;

    const ordem = { webhook: 0, integracao: 1, manual: 2 };
    const linhas = [...d.linhas].sort(
      (a, b) => (b.leads - a.leads) || ((ordem[a.entrada] ?? 3) - (ordem[b.entrada] ?? 3)),
    );

    const chave = d.chave?.chave ?? null;
    const base = location.origin;

    el.innerHTML = `
      <div class="cabeca">
        <div>
          <div class="kicker">// AQUISIÇÃO · ${esc(d.empresa.codigo)}</div>
          <h1 class="titulo">Canais de entrada</h1>
          <p class="chamada">
            Por onde o cliente da ${esc(d.empresa.nome)} chega, o que dá para medir
            e o que ainda entra na mão.
          </p>
        </div>
        <a class="btn quiet" href="#/atribuicao">Ver atribuição →</a>
      </div>

      <div class="grade g4">
        <div class="cartao kpi acento">
          <div class="r">COBERTURA ATRIBUÍVEL</div>
          <div class="v ac">${d.cobertura}%</div>
          <div class="n">${numero(d.atribuiveis)} de ${numero(d.total)} clientes</div>
        </div>
        <div class="cartao kpi">
          <div class="r">SEM ATRIBUIÇÃO POSSÍVEL</div>
          <div class="v ${d.naoAtribuiveis > d.atribuiveis ? 'warn' : ''}">${numero(d.naoAtribuiveis)}</div>
          <div class="n">balcão, telefone, indicação</div>
        </div>
        <div class="cartao kpi">
          <div class="r">CANAIS MAPEADOS</div>
          <div class="v">${numero(d.linhas.length - d.orfaos.length)}</div>
          <div class="n">no catálogo desta empresa</div>
        </div>
        <div class="cartao kpi">
          <div class="r">ORIGENS FORA DO CATÁLOGO</div>
          <div class="v ${d.orfaos.length ? 'crit' : 'ok'}">${numero(d.orfaos.length)}</div>
          <div class="n">${d.orfaos.length ? 'vieram de importação' : 'base limpa'}</div>
        </div>
      </div>

      ${d.cobertura < 50 ? `
        <div class="aviso warn" style="margin-top:16px">
          <strong>Menos da metade da base é atribuível.</strong>
          Isso não é defeito do sistema: balcão, telefone, guincho e indicação não
          carregam parâmetro de clique, e nunca vão carregar. A única atribuição
          possível nesses canais é <strong>perguntar</strong> — veja o bloco no fim
          da página. Sem isso, a campanha que trouxe o cliente aparece com zero
          retorno e é a primeira a ser cortada.
        </div>` : ''}

      ${d.orfaos.length ? `
        <div class="aviso crit" style="margin-top:16px">
          <strong>${numero(d.orfaos.length)} origem(ns) fora do catálogo:</strong>
          ${d.orfaos.map((o) => `<code>${esc(o.id)}</code> (${numero(o.leads)})`).join(', ')}.
          O sistema não inventa nome para origem que não conhece — isso esconderia
          justamente o que precisa ser arrumado na importação.
        </div>` : ''}

      <h2 class="secao">Todos os canais desta empresa</h2>
      <div class="tabela-caixa">
        <table>
          <thead><tr>
            <th>Canal</th><th>Tipo</th><th>Atribuível</th><th>Como entra</th>
            <th class="num">Clientes</th>
          </tr></thead>
          <tbody>
            ${linhas.map((c) => {
    const ent = ROTULO_ENTRADA[c.entrada] ?? { nome: '—', tag: 'crit', nota: 'Origem desconhecida.' };
    return `<tr>
              <td>
                <div class="forte">${esc(c.nome)}</div>
                <div class="fraco">${esc(c.nota ?? 'Origem que veio de importação e não está no catálogo.')}</div>
              </td>
              <td><span class="tag">${esc(d.tipos[c.tipo]?.nome ?? '—')}</span></td>
              <td>${c.atribuivel
    ? '<span class="tag ok">sim</span>'
    : '<span class="tag">não</span>'}</td>
              <td><span class="tag ${ent.tag}">${esc(ent.nome)}</span>
                  <div class="fraco">${esc(ent.nota)}</div></td>
              <td class="num ${c.leads ? 'forte' : 'fraco'}">${numero(c.leads)}</td>
            </tr>`;
  }).join('')}
          </tbody>
        </table>
      </div>

      <h2 class="secao">Porta pública de captação</h2>
      ${chave ? `
        <div class="cartao">
          <p style="font-size:13.5px;color:var(--dim);margin-bottom:12px">
            Cole o formulário abaixo no site da ${esc(d.empresa.nome)}. Ele captura
            <code>gclid</code>, <code>fbclid</code> e as UTMs <strong>no instante da
            chegada</strong> — depois disso o parâmetro de clique já se perdeu — e
            entrega o lead na triagem da Central. Nenhuma instância de empresa fica
            exposta a tráfego externo.
          </p>
          <div class="par"><dt>Endereço</dt>
            <dd><code>POST ${esc(base)}/api/entrada/${esc(chave)}</code></dd></div>
          <div class="par"><dt>Usos até agora</dt>
            <dd>${numero(d.chave.usos)}${d.chave.ultimoUsoEm ? ` · último em ${esc(ui.dataHora(d.chave.ultimoUsoEm))}` : ''}</dd></div>
          <div class="par"><dt>A chave é secreta?</dt>
            <dd>Não. Ela só <strong>roteia</strong> — não lê nada, não lista nada,
                não vira sessão. Por isso pode ficar num HTML público.</dd></div>

          <div class="barra-acoes" style="margin-top:14px">
            <button class="btn" id="copiar-snippet">Copiar formulário pronto</button>
            <button class="btn quiet" id="testar-porta">Enviar um lead de teste</button>
          </div>
          <div id="resultado-porta"></div>

          <details style="margin-top:14px">
            <summary style="cursor:pointer;color:var(--acento);font-size:13.5px">
              Ver o código
            </summary>
            <pre class="mensagem" style="margin-top:10px;overflow-x:auto"
                 id="snippet">${esc(snippet(base, chave, d.empresa.nome))}</pre>
          </details>
        </div>`
    : '<div class="aviso warn">Nenhuma chave de captação para esta empresa.</div>'}

      <h2 class="secao">Click-to-WhatsApp</h2>
      <div class="cartao">
        <p style="font-size:13.5px;color:var(--dim);margin-bottom:12px">
          O anúncio que <strong>abre a conversa</strong> em vez de abrir uma página é o
          único canal de WhatsApp que fecha o ciclo com a Meta. O identificador do
          clique — <code>ctwa_clid</code> — chega no webhook da
          <strong>primeira mensagem</strong> e em nenhum outro lugar: perder esse
          webhook é perder a atribuição daquele lead para sempre.
        </p>
        <div class="par"><dt>Endereço do webhook</dt>
          <dd><code>${esc(base)}/api/whatsapp/webhook</code></dd></div>
        <div class="par"><dt>Estado</dt>
          <dd>${d.whatsapp?.configurado
    ? '<span class="tag ok">assinatura configurada</span>'
    : '<span class="tag warn">sem segredo — a porta está fechada</span>'}</dd></div>
        <div class="par"><dt>Número desta empresa</dt>
          <dd>${esc(d.whatsapp?.numero ?? '—')}</dd></div>
        <div class="par"><dt>Mensagens recebidas</dt>
          <dd>${numero(d.whatsapp?.recebidas ?? 0)} · ${numero(d.whatsapp?.deAnuncio ?? 0)} vindas de anúncio</dd></div>
        ${(d.whatsapp?.semClique ?? 0) > 0 ? `
          <div class="aviso warn" style="margin-top:12px">
            <strong>${numero(d.whatsapp.semClique)} conversa(s) de anúncio chegaram sem
            <code>ctwa_clid</code>.</strong> Acontece de verdade — posicionamento em Status
            do WhatsApp é o caso conhecido. O sistema registra a ausência e não inventa um
            valor: um clique fabricado produz evento que a Meta aceita e que nunca casa com
            anúncio nenhum, o que é pior do que não mandar.
          </div>` : ''}
        ${!d.whatsapp?.configurado ? `
          <div class="aviso" style="margin-top:12px">
            Para ligar: defina <code>FORTCRM_META_APP_SECRET</code> e
            <code>FORTCRM_WHATSAPP_VERIFY_TOKEN</code> no servidor e aponte o webhook do
            app da Meta para o endereço acima, assinando o campo <code>messages</code>.
            Sem o segredo a porta recusa tudo — de propósito: o contrário funcionaria em
            desenvolvimento e viraria endpoint público de escrita em produção.
          </div>` : ''}
      </div>

      <h2 class="secao">O que perguntar quando não dá para medir</h2>
      <div class="cartao">
        <p style="font-size:14px;color:var(--txt)">
          Em balcão, telefone, guincho e indicação não existe parâmetro de clique.
          A pergunta abaixo é a <strong>única</strong> atribuição possível nesses
          canais — e é ela que impede que a campanha que funciona seja cortada por
          parecer que não trouxe ninguém.
        </p>
        <p style="font-size:17px;color:var(--txt-hi);margin:14px 0 10px">
          “${esc(d.pergunta)}”
        </p>
        <div style="display:flex;gap:7px;flex-wrap:wrap">
          ${d.respostas.map((r) => `<span class="tag">${esc(r.nome)}</span>`).join('')}
        </div>
      </div>`;

    el.querySelector('#copiar-snippet')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(snippet(base, chave, d.empresa.nome));
        toast('Formulário copiado', 'Cole na página do site onde o lead deve ser capturado.');
      } catch {
        // Área de transferência negada (contexto sem HTTPS, permissão do
        // navegador). Abrir o bloco de código é a saída que sempre funciona.
        el.querySelector('details').open = true;
        toast('Não consegui copiar', 'O código está aberto aqui embaixo — selecione e copie.');
      }
    });

    el.querySelector('#testar-porta')?.addEventListener('click', async (ev) => {
      ev.currentTarget.disabled = true;
      const saida = el.querySelector('#resultado-porta');
      try {
        const r = await fetch(`/api/entrada/${chave}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            nome: 'Lead de teste',
            telefone: '38999990000',
            canal: 'teste_da_tela',
            pagina: `${base}/teste`,
            parametros: { gclid: 'TESTE_' + Date.now(), utm_source: 'google', utm_medium: 'cpc' },
          }),
        }).then((x) => x.json());

        saida.innerHTML = `<div class="aviso ok" style="margin-top:12px">
          <strong>Recebido.</strong> Protocolo <code>${esc(r.dados?.protocolo ?? '—')}</code>.
          Ele está na triagem da Central — abra
          <a href="#/central">Central do grupo</a> para ver.
        </div>`;
      } catch (e) {
        saida.innerHTML = `<div class="aviso crit" style="margin-top:12px">${esc(e.message)}</div>`;
      }
      ev.currentTarget.disabled = false;
    });
  };
}

/**
 * O formulário pronto para colar.
 *
 * Captura a atribuição no `submit`, lendo a URL da página e o cookie `_fbp`.
 * É deliberadamente sem dependência: entra em site feito em WordPress, em
 * Wix ou em HTML escrito à mão, que é onde estes três clientes estão.
 */
function snippet(base, chave, empresa) {
  return `<!-- FORT-CRM — captação de lead · ${empresa} -->
<form id="fort-lead">
  <input name="nome"     placeholder="Seu nome"     required>
  <input name="telefone" placeholder="WhatsApp"     required>
  <input name="email"    placeholder="E-mail"       type="email">
  <textarea name="mensagem" placeholder="Como podemos ajudar?"></textarea>
  <button type="submit">Enviar</button>
</form>

<script>
document.getElementById('fort-lead').addEventListener('submit', function (ev) {
  ev.preventDefault();
  var f = ev.target;
  var q = new URLSearchParams(location.search);
  var params = {};
  // O parâmetro de clique só existe na PRIMEIRA página que o anúncio abriu.
  // Ler aqui, no envio, é o que garante que ele não se perca na navegação.
  ['gclid','gbraid','wbraid','fbclid','utm_source','utm_medium','utm_campaign','utm_term','utm_content']
    .forEach(function (k) { if (q.get(k)) params[k] = q.get(k); });

  var fbp = (document.cookie.match(/_fbp=([^;]+)/) || [])[1] || null;

  fetch('${base}/api/entrada/${chave}', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nome: f.nome.value, telefone: f.telefone.value,
      email: f.email.value, mensagem: f.mensagem.value,
      canal: 'site', pagina: location.href, referrer: document.referrer,
      fbp: fbp, parametros: params
    })
  }).then(function () {
    f.innerHTML = '<p>Recebemos seu contato. Falamos com você em breve.</p>';
  });
});
<\/script>`;
}
