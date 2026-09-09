/**
 * ERP do grupo: o painel e as telas de contas.
 *
 * A regra que organiza esta tela é a mesma do backend: **se o livro não fecha,
 * nenhum outro número vale**. Por isso a saúde vem antes de tudo — e quando ela
 * está ruim, os cartões não são desenhados. Um painel bonito sobre um razão
 * quebrado é pior do que tela nenhuma: ele dá confiança onde não há.
 *
 * Só aparece para quem tem o módulo concedido. O menu é desenhado a partir de
 * `GET /api/erp/acesso`, e não de uma lista fixa — assim a tela nunca oferece
 * uma porta que o servidor vai fechar.
 */

const CENTAVOS = (v) => (v == null ? '—' : (v / 100).toLocaleString('pt-BR', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
}));
const REAIS = (v) => `R$ ${CENTAVOS(v)}`;

/** Nome curto do mês para a série. "2026-09" → "set/26". */
function mesCurto(competencia) {
  const [a, m] = String(competencia).split('-');
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${nomes[Number(m) - 1] ?? m}/${a.slice(2)}`;
}

/* ══ Painel ═══════════════════════════════════════════════════════════════ */

export function telaErp(ui) {
  return async (el) => {
    const { esc } = ui;
    const acesso = await ui.api('/erp/acesso');
    const meus = acesso.meus ?? {};

    if (!meus.bi && !meus.razao) {
      el.innerHTML = `
        <div class="vazio">
          <h2>ERP do grupo</h2>
          <p>Você não tem acesso a nenhum módulo do ERP. Quem administra o sistema
             concede em <b>Acesso por módulo</b>.</p>
        </div>`;
      return;
    }

    const d = await ui.api('/erp/painel');

    /*
     * A saúde primeiro, e não como rodapé.
     *
     * Quando o razão está inconsistente, os números do painel são desenhados
     * com o alerta em cima e não sozinhos: a pessoa precisa saber ANTES de ler
     * qualquer valor, e não depois de já ter tirado a conclusão.
     */
    const alerta = (a) => `
      <div class="erp-alerta ${esc(a.nivel)}">
        <b>${a.nivel === 'critico' ? 'Atenção' : 'Aviso'}</b>
        <span>${esc(a.texto)}</span>
      </div>`;

    const empresas = Object.entries(d.empresas ?? {});
    const maiorMes = Math.max(1, ...(d.meses ?? []).map((m) => Math.max(m.receita, m.despesa)));

    el.innerHTML = `
      <div class="cabecalho">
        <div>
          <div class="olho">// ERP DO GRUPO</div>
          <h1>Comando do grupo</h1>
          <p class="sub">
            O consolidado das três instâncias, apurado por partida dobrada.
            Competência <b>${esc(mesCurto(d.competencia))}</b>.
          </p>
        </div>
        <div class="cabecalho-acoes">
          ${meus.razao === 'escrever' || meus.razao === 'administrar'
    ? '<button class="btn" id="sincronizar">Sincronizar instâncias</button>' : ''}
        </div>
      </div>

      ${(d.alertas ?? []).map(alerta).join('')}

      ${d.saudavel ? '' : `
        <div class="erp-parado">
          <b>O painel está bloqueado.</b>
          O razão não fecha, e todo número daqui seria calculado sobre um livro
          inconsistente. Abra a conferência para ver o que está fora do lugar.
          <button class="btn" id="conferir">Ver a conferência</button>
        </div>`}

      ${d.saudavel ? `
        <div class="erp-placa">
          <div>
            <dt>Receita do mês</dt>
            <dd class="pos">${REAIS(d.grupo.receita)}</dd>
          </div>
          <div>
            <dt>Despesa do mês</dt>
            <dd class="neg">${REAIS(d.grupo.despesa)}</dd>
          </div>
          <div>
            <dt>Resultado</dt>
            <dd class="${d.grupo.resultado >= 0 ? 'pos' : 'neg'}">${REAIS(d.grupo.resultado)}</dd>
          </div>
          <div>
            <dt>A receber</dt>
            <dd>${REAIS(d.grupo.receber)}</dd>
            ${d.grupo.receberVencido
    ? `<small class="neg">${REAIS(d.grupo.receberVencido)} vencido</small>` : ''}
          </div>
          <div>
            <dt>A pagar</dt>
            <dd>${REAIS(d.grupo.pagar)}</dd>
            ${d.grupo.pagarVencido
    ? `<small class="neg">${REAIS(d.grupo.pagarVencido)} vencido</small>` : ''}
          </div>
        </div>

        <h2 class="secao">Por empresa</h2>
        <div class="erp-empresas">
          ${empresas.map(([cod, e]) => `
            <div class="erp-empresa ${e.resultado >= 0 ? 'ok' : 'ruim'}">
              <div class="erp-empresa-topo">
                <b>${esc(cod)}</b>
                <span class="${e.resultado >= 0 ? 'pos' : 'neg'}">${REAIS(e.resultado)}</span>
              </div>
              <dl>
                <div><dt>Receita</dt><dd>${REAIS(e.receita)}</dd></div>
                <div><dt>Despesa</dt><dd>${REAIS(e.despesa)}</dd></div>
                <div><dt>A receber</dt><dd>${REAIS(e.receber)}</dd></div>
                <div><dt>A pagar</dt><dd>${REAIS(e.pagar)}</dd></div>
              </dl>
            </div>`).join('') || '<p class="fraco">Nenhum movimento nesta competência.</p>'}
        </div>

        ${(d.meses ?? []).length > 1 ? `
          <h2 class="secao">Doze meses</h2>
          <div class="erp-serie" role="img"
               aria-label="Receita e despesa dos últimos ${d.meses.length} meses">
            ${d.meses.map((m) => `
              <div class="erp-mes" title="${esc(mesCurto(m.competencia))}: receita ${REAIS(m.receita)}, despesa ${REAIS(m.despesa)}">
                <div class="erp-barras">
                  <i class="rec" style="height:${Math.round((m.receita / maiorMes) * 100)}%"></i>
                  <i class="desp" style="height:${Math.round((m.despesa / maiorMes) * 100)}%"></i>
                </div>
                <span>${esc(mesCurto(m.competencia))}</span>
              </div>`).join('')}
          </div>
          <div class="erp-legenda">
            <span><i class="rec"></i> receita</span>
            <span><i class="desp"></i> despesa</span>
          </div>` : ''}
      ` : ''}

      <h2 class="secao">Fatos das instâncias</h2>
      <div class="erp-fatos">
        ${(d.fatos.pendentes ?? []).length
    ? `<p><b>${d.fatos.pendentes.reduce((a, x) => a + x.n, 0)}</b> fato(s) aguardando
         contabilização: ${d.fatos.pendentes.map((x) => `${esc(x.instancia)} ${esc(x.tipo)} (${x.n})`).join(', ')}.</p>`
    : '<p class="fraco">Nada pendente — tudo que a operação entregou já está no razão.</p>'}
        ${d.fatos.divergentes
    ? `<p class="neg"><b>${d.fatos.divergentes}</b> fato(s) mudaram na origem
         depois de contabilizados. Estornar é decisão de quem responde pelo livro.</p>` : ''}
        <p class="fraco">Última leitura: ${d.fatos.ultimaLeitura ? esc(String(d.fatos.ultimaLeitura).slice(0, 16).replace('T', ' ')) : 'nunca'}.</p>
      </div>

      <div class="erp-portas">
        ${meus.contas_pagar ? '<a class="btn quiet" href="#/erp-titulos?natureza=pagar">Contas a pagar</a>' : ''}
        ${meus.contas_receber ? '<a class="btn quiet" href="#/erp-titulos?natureza=receber">Contas a receber</a>' : ''}
        ${meus.razao ? '<a class="btn quiet" href="#/erp-balancete">Balancete</a>' : ''}
      </div>`;

    el.querySelector('#conferir')?.addEventListener('click', async () => {
      const c = await ui.api('/erp/conferir');
      ui.abrirGaveta(`
        <header class="gaveta-topo">
          <h2>Conferência do livro</h2>
          <button class="btn quiet sm" data-fechar>Fechar</button>
        </header>
        <div class="gaveta-corpo">
          <p>${c.saudavel ? 'O livro está saudável.' : 'O livro tem inconsistência.'}</p>
          <ul class="tec">
            <li>Lançamentos que não somam zero: <b>${c.desbalanceados.length}</b></li>
            <li>Partidas em conta sintética: <b>${c.emSintetica.length}</b></li>
            <li>Títulos cujo saldo discorda das baixas: <b>${c.titulosTortos.length}</b></li>
            <li>Partidas órfãs: <b>${c.partidasOrfas}</b></li>
          </ul>
        </div>`);
    });

    el.querySelector('#sincronizar')?.addEventListener('click', async (ev) => {
      const b = ev.currentTarget;
      b.disabled = true;
      b.textContent = 'Lendo as instâncias…';
      try {
        const r = await ui.api('/erp/sincronizar', { method: 'POST', corpo: {} });
        /*
         * A completude é dita, e não escondida atrás de um "pronto".
         * Sincronização que não alcançou uma empresa não produziu consolidado
         * completo, por mais que a postagem tenha ido bem.
         */
        if (!r.completo) {
          ui.toast('Sincronização incompleta',
            `Não alcancei: ${r.colheita.falhas.map((f) => f.instancia).join(', ')}. `
            + 'Os números abaixo não incluem essa(s) empresa(s).', 'erro');
        } else {
          ui.toast('Instâncias lidas',
            `${r.colheita.novos} fato(s) novo(s), ${r.postagem.postados} contabilizado(s).`);
        }
        ui.navegar();
      } catch (e) {
        ui.toast('Não deu para sincronizar', e.message, 'erro');
        b.disabled = false;
        b.textContent = 'Sincronizar instâncias';
      }
    });
  };
}

/* ══ Contas a pagar e a receber ═══════════════════════════════════════════ */

export function telaTitulos(ui) {
  return async (el) => {
    const { esc } = ui;
    const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
    const natureza = q.get('natureza') === 'receber' ? 'receber' : 'pagar';
    const ehPagar = natureza === 'pagar';

    const lista = await ui.api(`/erp/titulos?natureza=${natureza}`);
    const abertos = lista.filter((t) => t.status !== 'quitado');
    const vencidos = abertos.filter((t) => t.vencido);
    const total = abertos.reduce((a, t) => a + t.saldo_centavos, 0);
    const totalVencido = vencidos.reduce((a, t) => a + t.saldo_centavos, 0);

    const FAIXAS = {
      em_dia: 'Em dia', ate_30: 'Até 30 dias', ate_60: '31 a 60', ate_90: '61 a 90', acima_90: 'Acima de 90',
    };

    el.innerHTML = `
      <div class="cabecalho">
        <div>
          <div class="olho">// ERP · ${ehPagar ? 'CONTAS A PAGAR' : 'CONTAS A RECEBER'}</div>
          <h1>${ehPagar ? 'O que o grupo deve' : 'O que o grupo tem a receber'}</h1>
          <p class="sub">
            <b>${REAIS(total)}</b> em ${abertos.length} título(s) em aberto.
            ${totalVencido ? `<span class="neg">${REAIS(totalVencido)} vencido em ${vencidos.length}.</span>` : 'Nada vencido.'}
          </p>
        </div>
        <div class="cabecalho-acoes">
          <a class="btn quiet" href="#/erp">‹ Painel</a>
        </div>
      </div>

      ${abertos.length ? `
        <div class="erp-faixas">
          ${Object.entries(FAIXAS).map(([k, rot]) => {
    const n = abertos.filter((t) => t.faixa === k);
    if (!n.length) return '';
    const v = n.reduce((a, t) => a + t.saldo_centavos, 0);
    return `<div class="erp-faixa ${k === 'em_dia' ? 'ok' : 'vencida'}">
                      <dt>${esc(rot)}</dt><dd>${REAIS(v)}</dd><small>${n.length} título(s)</small>
                    </div>`;
  }).join('')}
        </div>

        <div class="rolar">
          <table class="tabela">
            <thead>
              <tr>
                <th>Vencimento</th><th>Empresa</th><th>Descrição</th>
                <th class="num">Valor</th><th class="num">Saldo</th><th></th>
              </tr>
            </thead>
            <tbody>
              ${abertos.map((t) => `
                <tr class="${t.vencido ? 'vencida' : ''}">
                  <td class="mono">
                    ${esc(t.vencimento)}
                    ${t.vencido ? `<small class="neg">${t.atraso}d</small>` : ''}
                  </td>
                  <td class="mono">${esc(t.instancia)}</td>
                  <td>
                    ${esc(t.descricao)}
                    ${t.numero ? `<small class="fraco">${esc(t.numero)}</small>` : ''}
                  </td>
                  <td class="num mono">${CENTAVOS(t.valor_centavos)}</td>
                  <td class="num mono"><b>${CENTAVOS(t.saldo_centavos)}</b></td>
                  <td><button class="btn quiet sm" data-baixar="${esc(t.id)}">Baixar</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`
    : `<div class="vazio">
             <p>Nenhum título ${ehPagar ? 'a pagar' : 'a receber'} em aberto.</p>
           </div>`}`;

    el.querySelectorAll('[data-baixar]').forEach((b) => {
      b.onclick = async () => {
        const t = abertos.find((x) => x.id === b.dataset.baixar);
        const r = await ui.perguntar({
          contexto: `${t.instancia} · ${t.descricao}`,
          titulo: ehPagar ? 'Registrar pagamento' : 'Registrar recebimento',
          texto: `Saldo de ${REAIS(t.saldo_centavos)}. A baixa gera o lançamento no razão — `
            + 'nenhum dinheiro se move sem lançamento.',
          campos: [
            {
              nome: 'valor', rotulo: 'Valor', tipo: 'decimal',
              valor: CENTAVOS(t.saldo_centavos), dica: 'parcial é aceito',
            },
            {
              nome: 'meio', rotulo: 'Meio', tipo: 'selecao',
              opcoes: [
                { valor: 'pix', rotulo: 'PIX' },
                { valor: 'dinheiro', rotulo: 'Dinheiro' },
                { valor: 'debito', rotulo: 'Cartão de débito' },
                { valor: 'credito', rotulo: 'Cartão de crédito' },
                { valor: 'boleto', rotulo: 'Boleto' },
                { valor: 'transferencia', rotulo: 'Transferência' },
              ],
            },
          ],
          confirmar: ehPagar ? 'Pagar' : 'Receber',
        });
        if (!r) return;
        try {
          /*
           * O diálogo devolve REAIS em número — campo `decimal` tira o ponto de
           * milhar e converte. A rota recusa número cru justamente por ser
           * ambíguo, então a unidade é declarada aqui, onde ela é conhecida.
           *
           * Foi assim que uma baixa de R$ 1.850,00 entrou como R$ 18,50: o
           * número 1850 é inteiro válido nas duas leituras, e ninguém errou.
           */
          const feito = await ui.api(`/erp/titulos/${t.id}/baixar`, {
            method: 'POST',
            corpo: {
              valor_centavos: Math.round(Number(r.valor) * 100),
              meio: r.meio || 'pix',
            },
          });
          ui.toast(feito.status === 'quitado' ? 'Título quitado' : 'Baixa parcial',
            `Saldo agora: ${REAIS(feito.saldo)}.`);
          ui.navegar();
        } catch (e) {
          ui.toast('Não deu para baixar', e.message, 'erro');
        }
      };
    });
  };
}

/* ══ Balancete ════════════════════════════════════════════════════════════ */

export function telaBalancete(ui) {
  return async (el) => {
    const { esc } = ui;
    const b = await ui.api('/erp/balancete');

    const TIPOS = {
      ativo: 'Ativo', passivo: 'Passivo', patrimonio: 'Patrimônio líquido',
      receita: 'Receita', despesa: 'Despesa',
    };

    el.innerHTML = `
      <div class="cabecalho">
        <div>
          <div class="olho">// ERP · BALANCETE</div>
          <h1>Balancete do grupo</h1>
          <p class="sub">Acumulado de todas as competências, todas as empresas.</p>
        </div>
        <div class="cabecalho-acoes"><a class="btn quiet" href="#/erp">‹ Painel</a></div>
      </div>

      <div class="erp-fecha ${b.confere ? 'ok' : 'ruim'}">
        <b>${b.confere ? 'O livro fecha' : 'O livro NÃO fecha'}</b>
        <span>Débito ${REAIS(b.debito)} · Crédito ${REAIS(b.credito)}</span>
        ${b.confere ? '' : `<span class="neg">Diferença de ${REAIS(Math.abs(b.diferenca))}</span>`}
      </div>

      ${Object.entries(TIPOS).map(([tipo, rotulo]) => {
    const contas = b.contas.filter((c) => c.tipo === tipo && c.saldo !== 0);
    if (!contas.length) return '';
    const soma = contas.reduce((a, c) => a + c.saldo, 0);
    return `
          <h2 class="secao">${esc(rotulo)} <span class="fraco">${REAIS(soma)}</span></h2>
          <div class="rolar">
            <table class="tabela">
              <thead><tr><th>Conta</th><th></th><th class="num">Débito</th><th class="num">Crédito</th><th class="num">Saldo</th></tr></thead>
              <tbody>
                ${contas.map((c) => `
                  <tr>
                    <td class="mono">${esc(c.conta)}</td>
                    <td>${esc(c.nome)}</td>
                    <td class="num mono fraco">${CENTAVOS(c.debito)}</td>
                    <td class="num mono fraco">${CENTAVOS(c.credito)}</td>
                    <td class="num mono"><b>${CENTAVOS(c.saldo)}</b></td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`;
  }).join('')}

      <div class="erp-resultado">
        <span>Receita ${REAIS(b.receita)}</span>
        <span>− Despesa ${REAIS(b.despesa)}</span>
        <b class="${b.resultado >= 0 ? 'pos' : 'neg'}">= ${REAIS(b.resultado)}</b>
      </div>`;
  };
}
