/**
 * Modo de operação, em módulo próprio.
 *
 * Existe para quebrar um ciclo de importação: as rotas precisam do serviço de
 * conversão, e o serviço precisa saber se pode tocar a rede. Com a bandeira
 * dentro de `api.mjs`, os dois se importariam em círculo.
 *
 * `DEMO_MODE` liga por padrão e só desliga por variável de ambiente explícita.
 * O padrão inseguro seria o contrário — um esquecimento de configuração
 * mandaria mensagem e conversão de verdade.
 */
export const DEMO_MODE = process.env.DEMO_MODE !== 'false';
