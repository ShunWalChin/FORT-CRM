/**
 * Limite de requisições por origem.
 *
 * Existe por causa do deploy público. Em `127.0.0.1` nada disso importava: o
 * único cliente era quem estava na frente da tela. Exposto na internet, o
 * mesmo servidor atende quem aparecer — e este é um processo Node de thread
 * única com SQLite síncrono, onde uma rajada de requisições não degrada,
 * trava.
 *
 * Janela deslizante simples, em memória. Não sobrevive a reinício e não serve
 * para vários processos — e está certo assim: proteger um protótipo de
 * demonstração contra abuso casual é o objetivo, não construir um WAF.
 */

const JANELA_MS = 60_000;

/** Tetos por minuto, por origem. O mais específico vence. */
const TETOS = [
  // Reiniciar a demonstração apaga tudo e recarrega. Caro e raro.
  { padrao: /^POST \/api\/demo\/reiniciar$/, max: 3 },
  // Login: sem teto, vira oráculo de senha por força bruta.
  { padrao: /^POST \/api\/sessao$/, max: 12 },
  // Porta pública de captação: é a ÚNICA escrita sem sessão do sistema, e
  // portanto a única que um desconhecido pode chamar em volume. 20/min por
  // origem é folgado para um formulário de site e apertado para quem quiser
  // encher a triagem de lixo.
  { padrao: /^POST \/api\/entrada\//, max: 20 },
  // Escrita em geral.
  { padrao: /^(POST|PATCH|DELETE) /, max: 60 },
  // Leitura.
  { padrao: /^GET /, max: 300 },
];

const baldes = new Map();

/**
 * Identifica a origem. Atrás do Cloudflare Tunnel o IP real vem em
 * `cf-connecting-ip`; `x-forwarded-for` é aceito depois dele porque qualquer
 * cliente pode forjar esse cabeçalho e, sozinho, ele não identifica ninguém.
 */
export function origemDe(req) {
  return (
    req.headers['cf-connecting-ip']
    ?? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()
    ?? req.socket?.remoteAddress
    ?? 'desconhecida'
  ) || 'desconhecida';
}

/**
 * @returns {{permitido: boolean, restam: number, esperarSegundos: number, max: number}}
 */
export function consultarLimite(req, agoraMs = Date.now()) {
  const chaveRota = `${req.method} ${new URL(req.url, 'http://x').pathname}`;
  const teto = TETOS.find((t) => t.padrao.test(chaveRota)) ?? { max: 120 };
  const chave = `${origemDe(req)}|${teto.padrao ?? 'outros'}`;

  const marcas = (baldes.get(chave) ?? []).filter((t) => agoraMs - t < JANELA_MS);

  if (marcas.length >= teto.max) {
    baldes.set(chave, marcas);
    const maisAntiga = marcas[0];
    return {
      permitido: false,
      restam: 0,
      max: teto.max,
      esperarSegundos: Math.max(1, Math.ceil((JANELA_MS - (agoraMs - maisAntiga)) / 1000)),
    };
  }

  marcas.push(agoraMs);
  baldes.set(chave, marcas);
  return { permitido: true, restam: teto.max - marcas.length, max: teto.max, esperarSegundos: 0 };
}

/**
 * Descarta baldes vencidos. Sem isto o Map cresce com cada IP que passar —
 * um vazamento lento, do tipo que só aparece em produção semanas depois.
 */
export function limparBaldes(agoraMs = Date.now()) {
  let removidos = 0;
  for (const [chave, marcas] of baldes) {
    const vivas = marcas.filter((t) => agoraMs - t < JANELA_MS);
    if (vivas.length === 0) {
      baldes.delete(chave);
      removidos += 1;
    } else {
      baldes.set(chave, vivas);
    }
  }
  return removidos;
}

export function tamanhoBaldes() {
  return baldes.size;
}
