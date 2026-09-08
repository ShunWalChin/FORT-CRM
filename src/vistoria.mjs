/**
 * Vistoria de entrada: o documento que separa o que já estava do que a oficina fez.
 *
 * Sem ela, todo arranhão encontrado na entrega vira discussão sem árbitro — e a
 * oficina perde as duas coisas, o cliente e a razão. Com ela, e com o aceite do
 * dono antes de a ordem andar, a conversa deixa de ser sobre memória.
 *
 * Três propriedades que fazem dela um instrumento e não um formulário:
 *
 *   1. **É guiada.** Cada item diz o que olhar (`dica`). Um checklist que só
 *      lista nomes é preenchido no automático, e um preenchido no automático
 *      não vale como prova — nem para o cliente, nem para a oficina.
 *
 *   2. **Crítico exige evidência.** Não se marca "vermelho" sem foto. É o que
 *      impede o laudo de virar opinião, e o que sustenta o orçamento que vem
 *      depois: o dono vê o pneu careca antes de ouvir o preço.
 *
 *   3. **O aceite é sobre um conteúdo específico.** `hashConteudo` resume o que
 *      foi aceito; mexer num item depois muda o resumo e a divergência aparece.
 *      Um aceite que vale para qualquer versão do documento não vale nada.
 *
 * Sobre a origem da lista: é uma vistoria profissional montada para oficina de
 * injeção diesel, e **não** a transcrição da folha oficial de nenhuma rede. Os
 * itens são dados (`CHECKLIST`), não código — trocar pela folha oficial da rede
 * é editar esta constante, sem tocar em regra nenhuma.
 */

import { createHash } from 'node:crypto';
import { agora } from './db.mjs';

/** Semáforo. `na` é o item que não existe naquele veículo — não é "não olhei". */
export const ESTADOS = {
  ok: { nome: 'Conforme', cor: 'ok', ordem: 0 },
  atencao: { nome: 'Atenção', cor: 'warn', ordem: 1 },
  critico: { nome: 'Crítico', cor: 'crit', ordem: 2 },
  na: { nome: 'Não se aplica', cor: '', ordem: 3 },
};

/**
 * Os itens, por sistema do veículo.
 *
 * `foto: 'sempre'` — registro obrigatório mesmo estando tudo certo (as quatro
 * faces do veículo, o hodômetro). São eles que provam o estado na entrada.
 * `foto: 'defeito'` — foto exigida quando o item não passa.
 * `medida` — o item pede número, com unidade e faixa saudável.
 */
/**
 * Níveis de serviço.
 *
 * Vem da folha da rede, que separa a revisão em três profundidades. É a
 * diferença entre "conferir o filtro de ar" e "trocar o filtro de ar", e entre
 * uma revisão de 40 minutos e uma de três horas.
 *
 * Cada item declara o nível MÍNIMO em que entra: um item `bronze` está nos
 * três, um `ouro` só no mais completo. Assim a mesma lista serve às três
 * revisões, sem manter três listas que um dia divergem.
 */
export const NIVEIS = {
  bronze: {
    nome: 'Bronze',
    resumo: 'Revisão essencial',
    descricao: 'Segurança e fluidos. O que não pode faltar para o carro rodar.',
    ordem: 0,
  },
  prata: {
    nome: 'Prata',
    resumo: 'Revisão completa',
    descricao: 'Bronze mais os filtros, a suspensão sob elevador e o teste de rodagem.',
    ordem: 1,
  },
  ouro: {
    nome: 'Ouro',
    resumo: 'Revisão maior',
    descricao: 'Prata mais câmbio, diferencial, chassi e diagnóstico eletrônico completo.',
    ordem: 2,
  },
};

/** Um item de nível N entra em todas as revisões de N para cima. */
export function itemNoNivel(item, nivel) {
  return (NIVEIS[item.nivel]?.ordem ?? 0) <= (NIVEIS[nivel]?.ordem ?? 2);
}

/**
 * Os itens, agrupados por POSIÇÃO DO VEÍCULO — e não por sistema.
 *
 * Esta é a mudança que veio da folha da rede, e é a mais importante de todas.
 *
 * Agrupar por sistema (freios, suspensão, motor) é como se PENSA sobre um
 * carro. Não é como se TRABALHA nele: o técnico não pula do freio dianteiro
 * para o motor e volta ao freio traseiro. Ele recebe o carro no chão com o
 * cliente do lado, abre o capô, sobe o elevador até a meia altura, sobe até o
 * fim, desce, entra na cabine, e por último roda.
 *
 * A lista na ordem do trabalho elimina o vai-e-vem — e é a diferença entre uma
 * vistoria de quinze minutos e uma de quarenta.
 *
 * `foto: 'sempre'` — registro obrigatório mesmo estando tudo certo.
 * `foto: 'defeito'` — foto exigida quando o item não passa.
 * `medida` — o item pede número, com unidade e faixa.
 * `nivel` — a partir de qual revisão o item entra.
 */
export const CHECKLIST = [
  {
    grupo: 'Recepção com o cliente',
    posicao: 'Veículo no chão, cliente presente',
    dica: 'Feito ao lado do cliente, antes de o carro entrar. É o que ele vê e confirma.',
    itens: [
      { chave: 'hodometro', nome: 'Hodômetro', nivel: 'bronze', dica: 'Fotografe o painel com o número legível. É a leitura que alimenta a previsão dos próximos serviços.', foto: 'sempre', medida: { unidade: 'km' } },
      { chave: 'combustivel', nome: 'Nível de combustível', nivel: 'bronze', dica: 'Anote o nível na entrada. Evita a pergunta "saiu com menos?" na devolução.', foto: 'sempre' },
      { chave: 'placa_chassi', nome: 'Placa e chassi', nivel: 'bronze', dica: 'Confira a placa contra o chassi gravado. Divergência é assunto de documentação, não de oficina.', foto: 'sempre' },
      { chave: 'codigos_falha', nome: 'Leitura de códigos de avaria', nivel: 'bronze', dica: 'Scanner ANTES de mexer: motor e sistemas de segurança. Apagar sem anotar perde a pista.', foto: 'defeito' },
      { chave: 'servo_freio', nome: 'Servo-freio', nivel: 'bronze', dica: 'Motor desligado, pise cinco vezes; ao dar partida o pedal deve descer sozinho.', foto: 'defeito' },
      { chave: 'freio_hidraulico', nome: 'Retenção de pressão hidráulica', nivel: 'bronze', dica: 'Mantenha o pé no pedal por trinta segundos. Se afundar devagar, há vazamento interno.', foto: 'defeito' },
      { chave: 'freio_estacionamento', nome: 'Freio de estacionamento', nivel: 'bronze', dica: 'Tem de segurar o veículo em rampa. Conte os cliques do curso.', foto: 'defeito' },
      { chave: 'cintos', nome: 'Cintos de segurança', nivel: 'bronze', dica: 'Puxe com força: o cinto tem de travar. Confira enrolamento, fivela e fixações.', foto: 'defeito' },
      { chave: 'painel_luzes', nome: 'Painel e luzes de advertência', nivel: 'bronze', dica: 'Dê partida e fotografe o painel. Luz de injeção, ABS ou airbag acesa muda o orçamento inteiro.', foto: 'sempre' },
      { chave: 'ar_condicionado', nome: 'Ar-condicionado e climatização', nivel: 'bronze', dica: 'Ligue no máximo por um minuto e sinta a saída. Cheiro de mofo é filtro de cabine.', foto: 'defeito' },
      { chave: 'buzina', nome: 'Buzina', nivel: 'bronze', dica: 'Item obrigatório de segurança, e o mais esquecido da lista.', foto: 'defeito' },
      { chave: 'iluminacao_interna', nome: 'Iluminação interna', nivel: 'bronze', dica: 'Teto, porta-luvas e cortesia das portas.', foto: 'defeito' },
      { chave: 'iluminacao_ext', nome: 'Iluminação externa', nivel: 'bronze', dica: 'Acenda tudo: faróis, lanternas, placa, ré, freio e setas. Peça ajuda para conferir por trás.', foto: 'defeito' },
      { chave: 'limpador_esguicho', nome: 'Limpador e esguichos', nivel: 'bronze', dica: 'Jato mirado no vidro, e palheta que limpa sem riscar. Palheta ressecada risca o para-brisa.', foto: 'defeito' },
      { chave: 'pertences', nome: 'Pertences no interior', nivel: 'bronze', dica: 'Registre o que fica no veículo. Ferramenta, carga e documento somem da memória, não do vídeo.', foto: 'defeito' },
      { chave: 'extintor_triangulo', nome: 'Extintor, triângulo e macaco', nivel: 'bronze', dica: 'Itens obrigatórios; confira a validade do extintor e se o macaco está completo.', foto: 'defeito' },
    ],
  },
  {
    grupo: 'Exterior',
    posicao: 'Volta ao redor do veículo',
    dica: 'Uma volta completa, sempre no mesmo sentido. As quatro faces são o registro do estado de entrada.',
    itens: [
      { chave: 'frente', nome: 'Frente', nivel: 'bronze', dica: 'Enquadre o veículo inteiro, de frente, com a placa visível.', foto: 'sempre' },
      { chave: 'traseira', nome: 'Traseira', nivel: 'bronze', dica: 'Veículo inteiro, de trás. Inclua o para-choque.', foto: 'sempre' },
      { chave: 'lateral_esq', nome: 'Lateral esquerda', nivel: 'bronze', dica: 'De ponta a ponta. É onde aparecem amassados de corredor.', foto: 'sempre' },
      { chave: 'lateral_dir', nome: 'Lateral direita', nivel: 'bronze', dica: 'De ponta a ponta. É o lado do meio-fio, e junta risco de guia.', foto: 'sempre' },
      { chave: 'parabrisa', nome: 'Para-brisa e vidros', nivel: 'bronze', dica: 'Trinca no campo de visão do motorista reprova em vistoria. Fotografe de dentro, contra a luz.', foto: 'defeito' },
      { chave: 'carroceria', nome: 'Carroceria: corrosão e pintura', nivel: 'bronze', dica: 'Bolha de ferrugem na caixa de roda e na soleira. Marque cada avaria no diagrama.', foto: 'defeito' },
      { chave: 'retrovisores', nome: 'Retrovisores', nivel: 'bronze', dica: 'Inteiros, firmes e reguláveis.', foto: 'defeito' },
      { chave: 'dobradicas', nome: 'Dobradiças, travas e capô', nivel: 'prata', dica: 'Lubrifique dobradiças de porta, trinco do capô e batentes. Rangido vira reclamação.', foto: 'defeito' },
    ],
  },
  {
    grupo: 'Sob o capô',
    posicao: 'Capô aberto, motor frio',
    dica: 'Com o motor FRIO. Abrir o sistema de arrefecimento quente queima.',
    itens: [
      { chave: 'oleo_nivel', nome: 'Nível e aspecto do óleo', nivel: 'bronze', dica: 'Óleo leitoso é água na câmara — pare o serviço e avise. Fotografe a vareta.', foto: 'sempre' },
      { chave: 'liquido_nivel', nome: 'Líquido de arrefecimento', nivel: 'bronze', dica: 'Nível entre as marcas, com o motor frio. Ferrugem ou óleo boiando é problema sério.', foto: 'defeito' },
      { chave: 'antifreeze', nome: 'Concentração do aditivo', nivel: 'prata', dica: 'Meça com o refratômetro. Abaixo de -20 °C de proteção, troque.', foto: 'defeito', medida: { unidade: '%', min: 30, alerta: 40 } },
      { chave: 'fluido_freio', nome: 'Fluido de freio', nivel: 'bronze', dica: 'Nível entre as marcas e cor clara. Escuro absorveu água e ferve na descida.', foto: 'defeito' },
      { chave: 'fluido_freio_teor', nome: 'Teor de água no fluido', nivel: 'prata', dica: 'Teste com o medidor. Acima de 3% o ponto de ebulição cai perigosamente.', foto: 'defeito', medida: { unidade: '%', alerta: 2, max: 3 } },
      { chave: 'direcao_hidraulica', nome: 'Fluido da direção hidráulica', nivel: 'bronze', dica: 'Nível e cor. Escuro ou com cheiro de queimado é bomba sofrendo.', foto: 'defeito' },
      { chave: 'filtro_ar', nome: 'Filtro de ar', nivel: 'bronze', dica: 'Contra a luz: se não passa claridade, troque. Filtro saturado rouba potência.', foto: 'defeito' },
      { chave: 'filtro_cabine', nome: 'Filtro de cabine (ar-condicionado)', nivel: 'prata', dica: 'É o culpado do cheiro de mofo e do ar fraco. Quase sempre esquecido.', foto: 'defeito' },
      { chave: 'filtro_combustivel', nome: 'Filtro de combustível', nivel: 'bronze', dica: 'Confira a data da última troca. Filtro saturado mata bomba de alta.', foto: 'defeito' },
      { chave: 'separador_agua', nome: 'Separador de água', nivel: 'bronze', dica: 'Drene e fotografe o que sair. Água no diesel é a causa número um de bomba queimada.', foto: 'sempre' },
      { chave: 'correias', nome: 'Correias e tensores', nivel: 'bronze', dica: 'Trinca transversal, brilho de patinação e ruído no tensor.', foto: 'defeito' },
      { chave: 'correia_dentada', nome: 'Correia dentada', nivel: 'ouro', dica: 'Confira o intervalo contra o km. Romper significa motor fundido.', foto: 'defeito' },
      { chave: 'mangueiras', nome: 'Mangueiras e abraçadeiras', nivel: 'bronze', dica: 'Aperte com a mão: mangueira boa volta, mangueira velha fica marcada.', foto: 'defeito' },
      { chave: 'radiador', nome: 'Radiador e colmeia', nivel: 'bronze', dica: 'Colmeia entupida de barro e inseto derruba a troca de calor.', foto: 'defeito' },
      { chave: 'bateria', nome: 'Bateria: tensão em repouso', nivel: 'bronze', dica: 'Abaixo de 12,4 V está descarregada; abaixo de 12,0 V, sulfatada.', foto: 'defeito', medida: { unidade: 'V', min: 12.0, alerta: 12.4 } },
      { chave: 'terminais_bateria', nome: 'Terminais e cabos', nivel: 'bronze', dica: 'Zinabre e terminal frouxo derrubam a partida e enganam o diagnóstico.', foto: 'defeito' },
      { chave: 'alternador', nome: 'Carga do alternador', nivel: 'bronze', dica: 'Com o motor em marcha, a tensão deve subir para 13,8–14,4 V.', foto: 'defeito', medida: { unidade: 'V', min: 13.5, alerta: 13.8 } },
      { chave: 'chicotes', nome: 'Chicotes e componentes', nivel: 'prata', dica: 'Emenda com fita isolante perto do escape é começo de incêndio.', foto: 'defeito' },
      { chave: 'vazamentos_motor', nome: 'Vazamentos no motor', nivel: 'bronze', dica: 'Cárter, tampa de válvulas e retentor. Fotografe a poça, se houver.', foto: 'defeito' },
      { chave: 'coxins', nome: 'Coxins e fixações', nivel: 'prata', dica: 'Motor batendo na carroceria em aceleração.', foto: 'defeito' },
      { chave: 'tubulacoes_diesel', nome: 'Tubulações e conexões de diesel', nivel: 'bronze', dica: 'Umidade de diesel em conexão é entrada de ar no sistema.', foto: 'defeito' },
      { chave: 'respiro_motor', nome: 'Respiro do motor', nivel: 'prata', dica: 'Respiro entupido pressuriza o cárter e empurra óleo pelos retentores.', foto: 'defeito' },
      { chave: 'vacuo', nome: 'Mangueiras de vácuo', nivel: 'prata', dica: 'Trinca em mangueira de vácuo dá marcha lenta irregular e engana o scanner.', foto: 'defeito' },
    ],
  },
  {
    grupo: 'Meia altura',
    posicao: 'Elevador na altura da cintura, rodas removidas',
    dica: 'A altura em que se trabalha nas rodas. Remova as quatro antes de começar.',
    itens: [
      { chave: 'sulco_de', nome: 'Sulco — dianteiro esquerdo', nivel: 'bronze', dica: 'Meça no ponto mais gasto. Mínimo legal 1,6 mm.', foto: 'defeito', medida: { unidade: 'mm', min: 1.6, alerta: 3 } },
      { chave: 'sulco_dd', nome: 'Sulco — dianteiro direito', nivel: 'bronze', dica: 'Compare com o esquerdo: diferença grande é geometria.', foto: 'defeito', medida: { unidade: 'mm', min: 1.6, alerta: 3 } },
      { chave: 'sulco_te', nome: 'Sulco — traseiro esquerdo', nivel: 'bronze', dica: 'Meça no ponto mais gasto do eixo.', foto: 'defeito', medida: { unidade: 'mm', min: 1.6, alerta: 3 } },
      { chave: 'sulco_td', nome: 'Sulco — traseiro direito', nivel: 'bronze', dica: 'Meça no ponto mais gasto do eixo.', foto: 'defeito', medida: { unidade: 'mm', min: 1.6, alerta: 3 } },
      { chave: 'desgaste_irregular', nome: 'Desgaste irregular', nivel: 'bronze', dica: 'Gasto só na borda é geometria; no centro é calibragem alta. Fotografe a banda.', foto: 'defeito' },
      { chave: 'calibragem', nome: 'Calibragem dos pneus', nivel: 'bronze', dica: 'Confira contra a etiqueta da coluna, com o pneu frio.', foto: 'defeito', medida: { unidade: 'psi' } },
      { chave: 'rodas', nome: 'Rodas e parafusos', nivel: 'bronze', dica: 'Trinca na roda e parafuso faltando são reprovação imediata.', foto: 'defeito' },
      { chave: 'rolamentos', nome: 'Rolamentos de roda', nivel: 'prata', dica: 'Gire a roda solta e balance nas posições 12/6 e 3/9. Folga ou ronco condena.', foto: 'defeito' },
      { chave: 'freio_dianteiro', nome: 'Freio dianteiro (visual)', nivel: 'bronze', dica: 'Pastilha, disco e pinça. Passe a unha na face do disco.', foto: 'defeito', medida: { unidade: 'mm', min: 2, alerta: 3 } },
      { chave: 'freio_traseiro', nome: 'Freio traseiro (visual)', nivel: 'bronze', dica: 'Lona, tambor ou disco. Cilindro de roda vazando molha a lona.', foto: 'defeito', medida: { unidade: 'mm', min: 2, alerta: 3 } },
      { chave: 'flexiveis_freio', nome: 'Flexíveis de freio', nivel: 'bronze', dica: 'Trinca na borracha e bolha sob pressão. Qualquer umidade é crítico.', foto: 'defeito' },
      { chave: 'amortecedores', nome: 'Amortecedores e molas', nivel: 'bronze', dica: 'Óleo escorrido na haste. Amortecedor vazando não amortece.', foto: 'defeito' },
      { chave: 'pivos_bandejas', nome: 'Pivôs, bandejas e buchas', nivel: 'bronze', dica: 'Alavanque com a barra e sinta a folga. Bucha rachada bate em lombada.', foto: 'defeito' },
      { chave: 'terminais_coifas', nome: 'Terminais e coifas de direção', nivel: 'bronze', dica: 'Coifa rasgada deixa entrar água e barro: a peça morre em semanas.', foto: 'defeito' },
      { chave: 'homocineticas', nome: 'Homocinéticas e semieixos', nivel: 'prata', dica: 'Coifa rasgada joga graxa na roda. Estalo em curva é junta batendo.', foto: 'defeito' },
      { chave: 'caixa_direcao', nome: 'Caixa de direção', nivel: 'prata', dica: 'Folga axial e vazamento nas coifas dos dois lados.', foto: 'defeito' },
    ],
  },
  {
    grupo: 'Altura total',
    posicao: 'Elevador no alto',
    dica: 'A altura da parte de baixo. É onde o chassi e o escapamento aparecem.',
    itens: [
      { chave: 'dreno_oleo', nome: 'Dreno do óleo e filtro', nivel: 'bronze', dica: 'Drene quente, troque a arruela do bujão e aperte no torque.', foto: 'defeito' },
      { chave: 'oleo_cambio', nome: 'Óleo do câmbio', nivel: 'ouro', dica: 'Nível pelo bujão lateral, se houver. Cheiro de queimado condena.', foto: 'defeito' },
      { chave: 'oleo_diferencial', nome: 'Óleo do diferencial', nivel: 'ouro', dica: 'Nível e presença de limalha no bujão magnético.', foto: 'defeito' },
      { chave: 'vazamento_transmissao', nome: 'Vazamentos: motor, câmbio, diferencial', nivel: 'bronze', dica: 'Olhe de baixo com lanterna. Poça no chão denuncia antes.', foto: 'defeito' },
      { chave: 'escapamento', nome: 'Escapamento e coxins', nivel: 'bronze', dica: 'Furo, solda aberta e abraçadeira frouxa. Escapamento roçando vibra a carroceria.', foto: 'defeito' },
      { chave: 'linhas_freio', nome: 'Linhas de freio e combustível', nivel: 'bronze', dica: 'Corrosão na tubulação rígida ao longo do assoalho.', foto: 'defeito' },
      { chave: 'cabos_freio_mao', nome: 'Cabos do freio de mão', nivel: 'prata', dica: 'Cabo enferrujado agarra e o freio não solta.', foto: 'defeito' },
      { chave: 'assoalho', nome: 'Assoalho e chassi: corrosão', nivel: 'ouro', dica: 'Bata com o cabo da chave: som surdo é ferrugem por baixo da tinta.', foto: 'defeito' },
    ],
  },
  {
    grupo: 'Veículo abaixado',
    posicao: 'De volta ao chão',
    dica: 'Os três passos que fecham o serviço mecânico.',
    itens: [
      { chave: 'reabastecer_oleo', nome: 'Reabastecer o óleo', nivel: 'bronze', dica: 'Complete na especificação do fabricante e confira na vareta depois de assentar.', foto: 'defeito' },
      { chave: 'estepe', nome: 'Estepe: estado, sulco e pressão', nivel: 'bronze', dica: 'Ninguém descobre que o estepe está vazio no acostamento.', foto: 'defeito', medida: { unidade: 'mm', min: 1.6 } },
      { chave: 'torque_rodas', nome: 'Torque dos parafusos de roda', nivel: 'bronze', dica: 'Torquímetro, em estrela, no valor do fabricante. Roda solta mata.', foto: 'defeito', medida: { unidade: 'Nm' } },
    ],
  },
  {
    grupo: 'Diagnóstico eletrônico',
    posicao: 'Scanner conectado',
    dica: 'Só quando o plano de revisão inclui, ou quando há luz acesa no painel.',
    itens: [
      { chave: 'ecu_codigos', nome: 'Códigos armazenados na ECU', nivel: 'prata', dica: 'Leia e ANOTE antes de apagar. Código intermitente some e volta em semanas.', foto: 'defeito' },
      { chave: 'pressao_rail', nome: 'Pressão de rail', nivel: 'prata', dica: 'Em marcha lenta e em aceleração. Fora da faixa é bomba ou regulador.', foto: 'defeito', medida: { unidade: 'bar' } },
      { chave: 'retorno_bicos', nome: 'Retorno dos bicos', nivel: 'ouro', dica: 'Retorno excessivo num cilindro isola o bico com defeito antes de desmontar.', foto: 'defeito', medida: { unidade: 'ml/min' } },
      { chave: 'opacidade', nome: 'Teste de opacidade (fumaça)', nivel: 'ouro', dica: 'Preta é excesso de combustível, azul é óleo, branca é água. Grave um vídeo acelerando.', foto: 'defeito' },
      { chave: 'reset_revisao', nome: 'Reset do aviso de revisão', nivel: 'bronze', dica: 'Zere o indicador de manutenção, se o veículo tiver.', foto: 'defeito' },
    ],
  },
  {
    grupo: 'Após o serviço',
    posicao: 'Teste de rodagem e entrega',
    dica: 'O que separa "consertado" de "conferido". Janela aberta, rádio desligado.',
    itens: [
      { chave: 'partida_frio', nome: 'Partida a frio', nivel: 'bronze', dica: 'Conte os segundos até pegar e observe a fumaça inicial.', foto: 'defeito' },
      { chave: 'ventoinha', nome: 'Ventoinha do radiador', nivel: 'bronze', dica: 'Deixe aquecer e confirme que aciona na temperatura certa.', foto: 'defeito' },
      { chave: 'ruidos', nome: 'Ruídos anormais em rodagem', nivel: 'prata', dica: 'Passe em lombada e piso irregular. Batida em buraco é suspensão.', foto: 'defeito' },
      { chave: 'pedal_freio', nome: 'Resposta e curso do freio', nivel: 'bronze', dica: 'Pedal baixo, esponjoso ou puxando para um lado.', foto: 'defeito' },
      { chave: 'desempenho', nome: 'Desempenho e resposta', nivel: 'prata', dica: 'Falha de aceleração, engasgo em carga e perda de força em subida.', foto: 'defeito' },
      { chave: 'temperatura', nome: 'Temperatura em operação', nivel: 'bronze', dica: 'Acompanhe o ponteiro depois de dez minutos rodando.', foto: 'defeito' },
      { chave: 'qc_final', nome: 'Conferência final e limpeza', nivel: 'bronze', dica: 'Ferramenta fora do vão do motor, tapete no lugar, nada de graxa no volante.', foto: 'defeito' },
    ],
  },
];

/**
 * Todos os itens do nível pedido, numa lista só, na ordem do trabalho.
 *
 * A posição é atribuída DEPOIS do filtro: numa revisão Bronze os itens ficam
 * numerados de 0 a 63 sem buracos, e não com os saltos dos itens de Ouro que
 * não entraram.
 */
export function itensDoChecklist(nivel = 'ouro') {
  const saida = [];
  let pos = 0;
  for (const g of CHECKLIST) {
    for (const i of g.itens) {
      if (!itemNoNivel(i, nivel)) continue;
      saida.push({ ...i, grupo: g.grupo, posicao: pos });
      pos += 1;
    }
  }
  return saida;
}

/** O catálogo completo, recortado no nível — para a tela desenhar as abas. */
export function catalogoDoNivel(nivel = 'ouro') {
  return CHECKLIST
    .map((g) => ({ ...g, itens: g.itens.filter((i) => itemNoNivel(i, nivel)) }))
    .filter((g) => g.itens.length);
}

/** Quantos itens cada revisão tem. A tela usa para explicar a escolha. */
export const TAMANHO_POR_NIVEL = Object.fromEntries(
  Object.keys(NIVEIS).map((n) => [n, itensDoChecklist(n).length]),
);

export const TOTAL_ITENS = itensDoChecklist('ouro').length;

/** O item exige foto no estado em que foi marcado? */
export function exigeFoto(item, estado) {
  if (item.foto === 'sempre') return estado !== 'na';
  if (item.foto === 'defeito') return estado === 'critico' || estado === 'atencao';
  return false;
}

/**
 * O que falta para esta vistoria poder ir ao cliente.
 *
 * Devolve a lista de pendências, e não um booleano: "não pode enviar" sem dizer
 * o que falta obriga a pessoa a caçar o item numa lista de sessenta.
 */
export function pendencias(itens, midiasPorItem = {}, nivel = 'ouro') {
  /*
   * O catálogo vem dos ITENS DA VISTORIA, e não do nível.
   *
   * Uma vistoria aberta como Prata e o catálogo depois editado para mover um
   * item de nível passaria a cobrar algo que aquela vistoria nunca teve. Os
   * itens foram criados na abertura; são eles que valem.
   */
  const doNivel = new Map(itensDoChecklist(nivel).map((i) => [i.chave, i]));
  const catalogo = new Map(
    itens.map((i) => [i.chave, doNivel.get(i.chave) ?? { nome: i.nome, grupo: i.grupo, foto: 'defeito' }]),
  );
  const faltas = [];

  for (const [chave, def] of catalogo) {
    const marcado = itens.find((i) => i.chave === chave);
    if (!marcado || !marcado.estado) {
      faltas.push({ chave, nome: def.nome, grupo: def.grupo, falta: 'nao_avaliado' });
      continue;
    }
    if (exigeFoto(def, marcado.estado) && !(midiasPorItem[marcado.id]?.length)) {
      faltas.push({
        chave,
        nome: def.nome,
        grupo: def.grupo,
        falta: marcado.estado === 'critico' || marcado.estado === 'atencao'
          ? 'foto_do_defeito'
          : 'foto_obrigatoria',
      });
    }
  }
  return faltas;
}

/**
 * Resumo do que foi aceito.
 *
 * Entram o veículo, o km, e cada item com estado, medida e a impressão digital
 * das mídias. Não entram data de criação nem quem digitou: o cliente aceita o
 * ESTADO DO VEÍCULO, e a vistoria continuar a mesma depois de o técnico
 * corrigir a própria grafia numa nota é o comportamento certo.
 */
export function hashConteudo(vistoria, itens, midias = []) {
  const midiasPor = new Map();
  for (const m of midias) {
    const lista = midiasPor.get(m.item_id) ?? [];
    lista.push(m.sha256 ?? m.arquivo);
    midiasPor.set(m.item_id, lista);
  }

  const corpo = {
    veiculo: vistoria.veiculo_id,
    km: vistoria.km ?? null,
    combustivel: vistoria.nivel_combustivel ?? null,
    itens: [...itens]
      .sort((a, b) => a.chave.localeCompare(b.chave))
      .map((i) => ({
        chave: i.chave,
        estado: i.estado ?? null,
        medida: i.medida ?? null,
        nota: i.nota ?? null,
        midias: (midiasPor.get(i.id) ?? []).sort(),
      })),
  };
  return createHash('sha256').update(JSON.stringify(corpo)).digest('hex');
}

/**
 * A ordem de serviço só anda com vistoria aceita.
 *
 * É a regra que dá sentido a tudo acima: sem ela a vistoria vira papel que se
 * preenche depois, para constar. Devolve o motivo, porque a tela precisa dizer
 * o que fazer — e o que fazer é diferente em cada caso.
 */
export function podeIniciarOS(vistoria) {
  if (!vistoria) {
    return { pode: false, motivo: 'sem_vistoria', texto: 'Esta ordem não tem vistoria de entrada. Faça a vistoria antes de começar o serviço.' };
  }
  if (vistoria.status === 'aceita') return { pode: true };
  if (vistoria.status === 'rascunho') {
    return { pode: false, motivo: 'em_andamento', texto: 'A vistoria ainda está em preenchimento. Conclua e envie para o cliente aceitar.' };
  }
  if (vistoria.status === 'aguardando_aceite') {
    return { pode: false, motivo: 'sem_aceite', texto: 'A vistoria foi enviada e o cliente ainda não aceitou. O serviço começa depois do aceite.' };
  }
  if (vistoria.status === 'recusada') {
    return { pode: false, motivo: 'recusada', texto: `O cliente recusou a vistoria${vistoria.recusa_motivo ? `: ${vistoria.recusa_motivo}` : '.'} Refaça a vistoria ou converse com ele antes de seguir.` };
  }
  return { pode: false, motivo: 'cancelada', texto: 'Esta vistoria foi cancelada. Faça uma nova.' };
}

/** Contagem por estado, para o resumo da tela e do laudo. */
/**
 * Contagem por estado.
 *
 * O total vem dos ITENS DA VISTORIA, e não do catálogo: uma revisão Bronze tem
 * 64 itens, e mostrar "12 de 86" faria a barra parecer parada num serviço que
 * está quase pronto.
 */
export function resumo(itens) {
  const total = itens.length || 1;
  const r = { ok: 0, atencao: 0, critico: 0, na: 0, total: itens.length };
  for (const i of itens) if (i.estado) r[i.estado] = (r[i.estado] ?? 0) + 1;
  r.avaliados = itens.filter((i) => i.estado).length;
  r.pendente = itens.length - r.avaliados;
  r.percentual = Math.round((r.avaliados / total) * 100);
  return r;
}

/** Número legível da vistoria: VT-00042. */
export function proximoNumero(escopo) {
  const ultima = escopo.uma(
    "select numero from vistorias where {ESCOPO} and numero like 'VT-%' order by numero desc limit 1",
  );
  const n = ultima ? Number(String(ultima.numero).slice(3)) + 1 : 1;
  return `VT-${String(n).padStart(5, '0')}`;
}

export { agora };
