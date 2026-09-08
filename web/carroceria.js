/**
 * As cinco vistas do veículo, para marcar avaria na carroceria.
 *
 * O check-list responde "está funcionando?". O diagrama responde "COMO estava?"
 * — e é essa a pergunta da devolução, quando o dono aponta um risco na porta e
 * ninguém sabe dizer se ele já estava lá quando o carro entrou.
 *
 * Todas as vistas usam a MESMA caixa (200×120). É o que permite guardar a marca
 * como fração de 0 a 1 e desenhá-la de volta em qualquer tela: o mesmo toque no
 * celular de 375 px e no monitor de 1440 cai no mesmo ponto da lataria.
 *
 * O desenho é deliberadamente genérico — um sedã de traços simples. Silhueta
 * por modelo daria um sistema que precisa de desenhista toda vez que a oficina
 * atende um utilitário; e o técnico não marca o risco "no para-lama do Gol",
 * marca no lugar onde ele está.
 */

export const CAIXA = { largura: 200, altura: 120 };

const LATERAL = `
  <path class="cr-corpo" d="M10 92 L10 70 Q10 62 20 60 L56 56 L80 32 Q84 27 94 26 L136 26
                            Q147 26 152 32 L172 57 Q190 60 190 70 L190 92 Z"/>
  <path class="cr-vidro" d="M84 36 L108 36 L108 55 L72 55 Z"/>
  <path class="cr-vidro" d="M114 36 L134 36 L146 55 L114 55 Z"/>
  <path class="cr-traco" d="M110 57 L110 88"/>
  <rect class="cr-detalhe" x="96" y="62" width="12" height="3.5" rx="1.7"/>
  <path class="cr-detalhe" d="M10 64 L22 63 L22 70 L10 70 Z"/>
  <circle class="cr-roda" cx="54" cy="92" r="16"/>
  <circle class="cr-aro" cx="54" cy="92" r="7"/>
  <circle class="cr-roda" cx="150" cy="92" r="16"/>
  <circle class="cr-aro" cx="150" cy="92" r="7"/>
  <path class="cr-chao" d="M6 108 L194 108"/>`;

const FRENTE = `
  <path class="cr-corpo" d="M22 100 L22 62 Q22 52 34 48 L54 30 Q59 22 72 22 L128 22
                            Q141 22 146 30 L166 48 Q178 52 178 62 L178 100 Z"/>
  <path class="cr-vidro" d="M60 46 L140 46 L131 30 Q129 27 124 27 L76 27 Q71 27 69 30 Z"/>
  <rect class="cr-detalhe" x="26" y="56" width="36" height="14" rx="5"/>
  <rect class="cr-detalhe" x="138" y="56" width="36" height="14" rx="5"/>
  <rect class="cr-grade" x="72" y="56" width="56" height="16" rx="4"/>
  <rect class="cr-detalhe" x="22" y="78" width="156" height="17" rx="6"/>
  <rect class="cr-placa" x="78" y="81" width="44" height="11" rx="2"/>
  <rect class="cr-detalhe" x="8" y="49" width="14" height="9" rx="3"/>
  <rect class="cr-detalhe" x="178" y="49" width="14" height="9" rx="3"/>
  <path class="cr-chao" d="M6 108 L194 108"/>`;

const TRASEIRA = `
  <path class="cr-corpo" d="M22 100 L22 62 Q22 52 34 48 L52 30 Q57 23 70 23 L130 23
                            Q143 23 148 30 L166 48 Q178 52 178 62 L178 100 Z"/>
  <path class="cr-vidro" d="M58 46 L142 46 L133 31 Q131 28 126 28 L74 28 Q69 28 67 31 Z"/>
  <rect class="cr-lanterna" x="26" y="54" width="34" height="17" rx="4"/>
  <rect class="cr-lanterna" x="140" y="54" width="34" height="17" rx="4"/>
  <path class="cr-traco" d="M100 50 L100 78"/>
  <rect class="cr-detalhe" x="22" y="78" width="156" height="17" rx="6"/>
  <rect class="cr-placa" x="72" y="81" width="56" height="12" rx="2"/>
  <circle class="cr-detalhe" cx="152" cy="97" r="4"/>
  <path class="cr-chao" d="M6 108 L194 108"/>`;

const TETO = `
  <path class="cr-corpo" d="M20 60 C20 44 30 34 48 32 L146 28 C168 30 180 42 180 60
                            C180 78 168 90 146 92 L48 88 C30 86 20 76 20 60 Z"/>
  <path class="cr-vidro" d="M66 36 L92 39 L92 81 L66 84 Z"/>
  <rect class="cr-vidro" x="94" y="39" width="48" height="42" rx="5"/>
  <path class="cr-vidro" d="M144 40 L166 44 L166 76 L144 80 Z"/>
  <rect class="cr-detalhe" x="60" y="24" width="11" height="7" rx="2"/>
  <rect class="cr-detalhe" x="60" y="89" width="11" height="7" rx="2"/>
  <rect class="cr-roda" x="40" y="23" width="17" height="7" rx="2"/>
  <rect class="cr-roda" x="40" y="90" width="17" height="7" rx="2"/>
  <rect class="cr-roda" x="139" y="21" width="17" height="7" rx="2"/>
  <rect class="cr-roda" x="139" y="92" width="17" height="7" rx="2"/>`;

/**
 * A lateral direita é a esquerda espelhada.
 *
 * Espelhar o DESENHO e não a marca: o pino continua sendo desenhado nas
 * coordenadas cruas da caixa, então onde o técnico toca é onde a marca aparece.
 * Se o espelho pegasse os pinos junto, tocar na porta traseira marcaria a
 * dianteira — e ninguém conferiria isso na frente do cliente.
 */
export const VISTAS = {
  frente: { rotulo: 'Frente', desenho: FRENTE },
  lateral_dir: { rotulo: 'Lado direito', desenho: `<g transform="translate(200 0) scale(-1 1)">${LATERAL}</g>` },
  traseira: { rotulo: 'Traseira', desenho: TRASEIRA },
  lateral_esq: { rotulo: 'Lado esquerdo', desenho: LATERAL },
  teto: { rotulo: 'Visto de cima', desenho: TETO },
};

/** A ordem é a da volta ao redor do veículo, a mesma do grupo "Exterior". */
export const ORDEM_VISTAS = ['frente', 'lateral_dir', 'traseira', 'lateral_esq', 'teto'];
