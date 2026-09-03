/**
 * Laudo digital de bancada.
 *
 * É o item que a proposta chama de diferencial central: depois do teste, o
 * cliente recebe um documento com a pressão medida, a peça, a recomendação e a
 * garantia. Serve a um propósito comercial preciso — eliminar a objeção mais
 * cara do setor, "será que trocaram mesmo?".
 *
 * Sai como HTML preparado para impressão. O navegador gera o PDF; nenhuma
 * biblioteca de terceiro entra no caminho por causa disso, o que mantém o
 * protótipo em zero dependências.
 */

const SISTEMAS = {
  common_rail_cp3: 'Common Rail CP3',
  common_rail_cp4: 'Common Rail CP4',
  bomba_mecanica: 'Bomba mecânica em linha',
  bomba_rotativa: 'Bomba rotativa',
  uis_ups: 'Unidade injetora UIS/UPS',
  injecao_eletronica: 'Injeção eletrônica',
};

function esc(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function dataBr(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function moeda(centavos) {
  return (Number(centavos ?? 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function linha(rotulo, valor) {
  return `<div class="par"><dt>${esc(rotulo)}</dt><dd>${esc(valor ?? '—')}</dd></div>`;
}

export function laudoHtml(os, empresa) {
  const vencimentoGarantia = os.concluida_em
    ? new Date(Date.parse(os.concluida_em) + os.garantia_meses * 30 * 24 * 60 * 60 * 1000).toISOString()
    : null;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Laudo ${esc(os.numero)} — ${esc(empresa.nome)}</title>
<style>
  :root { --tinta:#15151d; --fraco:#5c5c6e; --linha:#e3dfd6; --acento:${esc(empresa.cor)}; --fundo:#fbfaf7; }
  * { box-sizing:border-box; margin:0; padding:0 }
  body { background:var(--fundo); color:var(--tinta); font:15px/1.6 "Segoe UI",Calibri,system-ui,sans-serif; padding:32px 20px }
  .folha { max-width:760px; margin:0 auto; background:#fff; border:1.5px solid var(--linha); border-radius:14px; padding:40px 44px }
  header { display:flex; justify-content:space-between; align-items:flex-start; gap:20px;
           border-bottom:3px solid var(--acento); padding-bottom:18px; margin-bottom:26px; flex-wrap:wrap }
  .marca { font-size:21px; font-weight:800; letter-spacing:-.4px }
  .marca span { color:var(--acento) }
  .sub { font-size:12.5px; color:var(--fraco) }
  .selo { text-align:right }
  .selo .n { font:700 13px ui-monospace,Consolas,monospace; letter-spacing:1px; color:var(--acento) }
  h1 { font-size:25px; letter-spacing:-.5px; margin-bottom:4px }
  .chamada { color:var(--fraco); font-size:14px; margin-bottom:26px }
  h2 { font-size:12px; letter-spacing:1.3px; text-transform:uppercase; color:var(--fraco);
       font-family:ui-monospace,Consolas,monospace; margin:26px 0 10px }
  dl { display:grid; grid-template-columns:1fr 1fr; gap:2px 24px }
  .par { display:flex; justify-content:space-between; gap:12px; padding:8px 0; border-bottom:1px solid var(--linha) }
  dt { color:var(--fraco); font-size:13.5px }
  dd { font-weight:600; font-size:14px; text-align:right }
  .destaque { display:flex; gap:14px; margin:22px 0; flex-wrap:wrap }
  .caixa { flex:1; min-width:170px; border:1.5px solid var(--linha); border-radius:12px; padding:16px 18px }
  .caixa .r { font:11.5px ui-monospace,Consolas,monospace; letter-spacing:.8px; color:var(--fraco) }
  .caixa .v { font-size:27px; font-weight:800; letter-spacing:-1px; line-height:1.25; margin-top:2px }
  .caixa.ok { background:#e7f3ea; border-color:#bfe0c8 } .caixa.ok .v { color:#2e7d46 }
  .caixa.ac { background:color-mix(in srgb, var(--acento) 10%, #fff); border-color:color-mix(in srgb, var(--acento) 30%, #fff) }
  .caixa.ac .v { color:var(--acento) }
  .parecer { background:#f2f0ea; border-left:5px solid var(--acento); border-radius:0 10px 10px 0;
             padding:16px 20px; margin:18px 0; font-size:14.5px }
  .assin { margin-top:34px; padding-top:20px; border-top:2px solid var(--linha);
           display:flex; justify-content:space-between; gap:20px; flex-wrap:wrap; font-size:12.5px; color:var(--fraco) }
  .rodape { margin-top:14px; font-size:11.5px; color:var(--fraco); line-height:1.5 }
  .acoes { max-width:760px; margin:0 auto 18px; display:flex; gap:10px }
  button { font:600 14px inherit; background:var(--acento); color:#fff; border:none;
           border-radius:9px; padding:11px 20px; cursor:pointer }
  button.ghost { background:transparent; color:var(--acento); border:1.5px solid var(--acento) }
  @media print { body { background:#fff; padding:0 } .acoes { display:none }
                 .folha { border:none; border-radius:0; max-width:none; padding:0 } }
  @media (max-width:620px) { dl { grid-template-columns:1fr } .folha { padding:26px 22px } }
</style>
</head>
<body>

<div class="acoes">
  <button onclick="window.print()">Salvar como PDF</button>
  <button class="ghost" onclick="window.close()">Fechar</button>
</div>

<div class="folha">
  <header>
    <div>
      <div class="marca">${esc(empresa.nome.split(' ')[0])} <span>${esc(empresa.nome.split(' ').slice(1).join(' '))}</span></div>
      <div class="sub">${esc(empresa.segmento)} · ${esc(empresa.cidade ?? '')}</div>
    </div>
    <div class="selo">
      <div class="n">LAUDO ${esc(os.numero)}</div>
      <div class="sub">Emitido em ${dataBr(os.concluida_em ?? os.aberta_em)}</div>
    </div>
  </header>

  <h1>Laudo digital de bancada</h1>
  <p class="chamada">Documento técnico do teste realizado em bancada aferida, emitido ao final da ordem de serviço.</p>

  <h2>Veículo</h2>
  <dl>
    ${linha('Placa', os.placa)}
    ${linha('Marca e modelo', [os.marca, os.modelo].filter(Boolean).join(' '))}
    ${linha('Ano', os.ano)}
    ${linha('Motorização', os.motorizacao)}
    ${linha('Sistema de injeção', SISTEMAS[os.sistema_injecao] ?? os.sistema_injecao)}
    ${linha('Quilometragem no serviço', os.km_servico ? `${Number(os.km_servico).toLocaleString('pt-BR')} km` : '—')}
  </dl>

  <h2>Ensaio</h2>
  <div class="destaque">
    <div class="caixa ac">
      <div class="r">PRESSÃO MEDIDA</div>
      <div class="v">${os.pressao_bar ? `${esc(os.pressao_bar)} bar` : '—'}</div>
    </div>
    <div class="caixa ok">
      <div class="r">RESULTADO</div>
      <div class="v" style="font-size:20px">${os.resultado_laudo ? 'Aprovado' : 'Em análise'}</div>
    </div>
    <div class="caixa">
      <div class="r">GARANTIA</div>
      <div class="v" style="font-size:20px">${esc(os.garantia_meses)} meses</div>
    </div>
  </div>

  <dl>
    ${linha('Componente ensaiado', os.componente)}
    ${linha('Bancada utilizada', os.bancada)}
    ${linha('Peça aplicada', os.peca_aplicada)}
    ${linha('Valor do serviço', moeda(os.valor_centavos))}
    ${linha('Garantia até', dataBr(vencimentoGarantia))}
    ${linha('Cliente', os.cliente_nome)}
  </dl>

  <div class="parecer">
    <strong>Parecer técnico.</strong> ${esc(os.resultado_laudo ?? 'Ensaio em andamento — laudo será emitido na conclusão da ordem de serviço.')}
  </div>

  <h2>Condições da garantia</h2>
  <p style="font-size:13.5px;color:var(--fraco)">
    A garantia cobre o componente ensaiado e a mão de obra aplicada, pelo prazo indicado, contado da data de
    entrega do veículo. Não cobre danos decorrentes de combustível contaminado, filtro fora do prazo de troca
    ou intervenção de terceiros no sistema de injeção. Guarde este laudo: ele é a comprovação do serviço.
  </p>

  <div class="assin">
    <div>
      <div style="border-top:1px solid var(--tinta);width:230px;padding-top:6px">
        Responsável técnico — ${esc(empresa.nome)}
      </div>
    </div>
    <div style="text-align:right">
      <div>Documento gerado eletronicamente</div>
      <div>${esc(os.numero)} · ${dataBr(os.concluida_em ?? os.aberta_em)}</div>
    </div>
  </div>

  <p class="rodape">
    Laudo emitido pelo CRM do grupo. Protótipo de demonstração — os dados exibidos são fictícios
    e não representam serviço prestado.
  </p>
</div>

</body>
</html>`;
}
