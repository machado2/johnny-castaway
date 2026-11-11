# Plano de remasterização: resolução adaptável, arte nova e animação suave

Plano preparado em 10/11/2026 a partir do código e dos recursos deste projeto. Este documento descreve trabalho futuro; não representa uma implementação ou validação de desempenho já concluída.

## Resultado pretendido

Preencher a janela em Full HD, ultrawide, telas convencionais, tablets e celulares, com cenários recriados, personagens proporcionais e animação com apresentação a 60 fps. A composição deve se adaptar à tela: ampliar as áreas de cenário e ajustar o enquadramento, sem deformar personagens nem cortar acontecimentos importantes.

A orientação mais recente do usuário substitui, para esta remasterização, a restrição de enquadramento fixo em 4:3. Ao iniciar a implementação, atualizar essa regra no AGENTS.md. As coordenadas originais podem continuar existindo internamente para preservar os roteiros, sem determinar a proporção da imagem apresentada.

Manter somente o canvas na interface, execução local e publicação no GitHub Pages em castaway.fbmac.net. A engenharia reversa continua baseada exclusivamente em SCRANTIC.SCR, RESOURCE.MAP e RESOURCE.001. A referência visual será a arte extraída desses arquivos. Direção artística inicial: desenho 2D com a identidade, as cores, as proporções e o humor do original, agora com contornos e detalhes bem resolvidos.

## Base observada

- O sistema informa monitores em 1920×1080 e 2560×1080, aproximadamente 60 Hz. A tela principal aparece com área lógica menor por causa da escala do Windows; resolução física e tamanho da janela precisam ser tratados separadamente.
- `web/dist/graphics.js` desenha em buffers fixos de 640×480, com cores indexadas. `main.js` amplia essa imagem sem suavização e centraliza em 4:3.
- `main.js` já usa requestAnimationFrame, mas só apresenta alterações depois de passos de 55 ms: no máximo aproximadamente 18,2 atualizações visuais por segundo. Os contadores internos usam passos de 16 ms; várias poses têm pausas adicionais.
- Existem 127 recursos de imagem, totalizando 2.402 imagens/poses, além de 41 roteiros TTM com 6.631 quadros de instruções e 611 sequências. Quadros de roteiro não equivalem a desenhos distintos.
- O catálogo contém 79 registros utilizáveis, incluindo os 11 capítulos. A remasterização precisa cobrir também ambientes especiais, introdução, encerramento, objetos, efeitos e datas especiais.
- `ttm.js` e `story.js` também escrevem pixels diretamente. Parte do visual é construída com linhas, círculos e cópias de regiões; trocar apenas os arquivos de imagem não cobre tudo.

## Etapa 1 — Catálogo visual e referência reproduzível

1. Gerar folhas de contato e amostras animadas a partir dos próprios recursos, organizadas por personagem, objeto, ambiente e sequência.
2. Registrar para cada imagem seu arquivo e índice originais, dimensões, transparência, ponto de apoio, espelhamentos, cenas que a usam e eventual reaproveitamento de uma mesma pose.
3. Catalogar separadamente desenhos produzidos pelo motor e referências inválidas já conhecidas. Referências nulas não devem se transformar em imagens inventadas; qualquer criação adicional deve ser identificada como parte da remasterização.
4. Criar reproduções determinísticas das cenas, fixando data e aleatoriedade para comparar comportamento, duração e áudio. Não substituir a progressão salva do usuário por dados de teste.
5. Criar um inventário de cobertura: cada uma das 2.402 imagens terá uma associação com a nova arte, inclusive quando duas referências compartilhem um mesmo desenho.

Entrega: catálogo rastreável e lista de produção completa, com referências da arte e dos movimentos originais.

## Etapa 2 — Primeira cena completa

Produzir primeiro uma amostra integrada com mar, céu, ilha, coqueiro, ondas e Johnny caminhando e realizando uma ação. Incluir oclusão atrás de um objeto, mudança de direção e um som sincronizado.

Preparar referências consistentes de Johnny visto de frente, costas, perfil e diagonais, com escala, paleta e espessura de contorno definidas. Recriar os principais quadros dessa cena usando essas referências; produzir também poses intermediárias e versões em retrato e ultrawide do cenário.

Comparar em movimento, no tamanho final dos dois monitores e de um celular. Verificar rosto, mãos, pés, roupa, estabilidade dos contornos, contato com o chão e encaixe entre camadas. Usar a amostra para fixar o padrão de qualidade e medir custo de produção por sequência antes de multiplicar o processo por todo o acervo.

Entrega: uma cena realmente remasterizada, preenchendo os formatos escolhidos e com movimento suave. Esta é a primeira entrega visual do projeto.

## Etapa 3 — Composição adaptável e desenho em alta resolução

Separar três responsabilidades: a história e suas coordenadas; a composição visual em camadas; a câmera e a resolução de saída.

- Preservar os roteiros, eventos e relações espaciais entre personagens e objetos. Aplicar escala uniforme aos elementos que interagem.
- Criar fundos extensíveis em camadas: céu, horizonte, mar, ilha, objetos e primeiro plano. As bordas adicionais precisam conter arte adequada, sem repetir mecanicamente a ilha ou duplicar elementos reconhecíveis.
- Em telas largas, revelar mais cenário nas laterais. Em retrato, ampliar céu/mar e posicionar a área de ação para manter boa leitura.
- Definir por cena os limites da ação essencial. A câmera deve enquadrá-los por completo, com margem; aproximar apenas quando couber e acompanhar movimentos sem saltos. Quando uma interação ocupar muita largura, reduzir o conjunto de forma uniforme.
- Criar extensões próprias para ambientes fechados e cenas especiais, que não podem receber automaticamente o fundo de mar.
- Considerar rotação, barras móveis do navegador, recortes de câmera do celular, redimensionamento, zoom e arrastar a janela entre os dois monitores.
- Dimensionar o canvas conforme a área disponível e a densidade de pixels, com limite de resolução interna ajustável. O DPR pode mudar entre monitores, conforme a [documentação do navegador](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio).

Manter 640×480 somente como referência interna da lógica. O desenho HD deve compor diretamente na resolução selecionada, sem passar por uma imagem final reduzida a 640×480.

Introduzir uma interface de desenho para imagens, linhas, círculos, máscaras, cópias e regiões persistentes. Encaminhar para ela os acessos diretos aos pixels existentes em `ttm.js` e `story.js`. Preservar a ordem de composição e os efeitos de salvar/restaurar fundos, incluindo objetos que permanecem no cenário.

Usar WebGL2 como primeira opção de renderização, com imagens agrupadas em atlas por família de cenas; manter uma alternativa Canvas 2D para ambientes sem WebGL utilizável. O piloto deve validar o custo antes de ampliar a arquitetura. Respeitar os limites de textura do aparelho e tratar perda/restauração do contexto. Agrupar desenhos e usar atlas são práticas documentadas para reduzir chamadas de desenho: [MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices#batch_draw_calls).

Entrega: composição adaptável com a cena piloto e caminho de desenho preparado para a arte completa.

## Etapa 4 — Produção de toda a arte

1. Produzir matrizes em alta resolução, em geral com 4× a dimensão linear original, chegando a 8× onde o enquadramento ou telas 4K exigirem. Fundos extensíveis terão dimensões próprias; o fator de escala dos sprites não limita a largura total do cenário.
2. Usar as imagens originais e as referências visuais já estabelecidas para orientar a recriação. Ferramentas de geração/edição podem ajudar na produção, com revisão de sequência inteira para corrigir variações de identidade, roupa, iluminação e proporções.
3. Recriar poses principais antes dos intermediários. Preservar apoios, silhuetas e momentos expressivos responsáveis pela leitura da ação.
4. Produzir transparência real e margens que impeçam halos nas bordas. Registrar pivôs, recortes, deslocamentos e tamanho lógico para evitar tremidas entre quadros de dimensões diferentes.
5. Exportar variantes menores a partir das matrizes, em pacotes por cena. Usar formatos com transparência e verificar o resultado visual da compressão; preservar matrizes sem perda.
6. Completar o inventário até alcançar todas as 2.402 referências válidas, os elementos desenhados pelo motor e os novos trechos de cenário.

Ordem de produção: cenário recorrente e caminhada; ações cotidianas; interações e personagens secundários; capítulos da história; ambientes especiais, datas comemorativas, introdução e encerramento.

Entrega: acervo completo com associação explícita entre recursos originais, arte nova e versões de resolução. A quantidade de novas poses será definida pela duração e complexidade dos movimentos, sem multiplicar todos os quadros indiscriminadamente.

## Etapa 5 — Movimento a 60 fps com o ritmo original

Separar o relógio da história da apresentação. Preservar inicialmente os passos lógicos existentes e seus efeitos; avaliar os movimentos visuais pelo tempo transcorrido entre eles. requestAnimationFrame acompanha normalmente a taxa da tela, e a progressão deve usar tempo para não acelerar em monitores de alta frequência: [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame).

- Interpolar deslocamentos contínuos, como caminhada, nuvens e objetos em movimento, com posições fracionárias.
- Criar quadros intermediários de pose para mudanças corporais; executar o mesmo desenho mais vezes não acrescenta movimento ao personagem.
- Animar ondas e outros ciclos ambientais com continuidade, preservando a composição e a direção artística.
- Associar os novos movimentos à identidade de cada ator e à fase da sequência original. Usar curvas e transições específicas; não interpolar entre cortes, trocas de cena ou poses sem relação.
- Manter pausas intencionais, acelerações, antecipações e impactos. A duração total das ações e os pontos de sincronização devem permanecer equivalentes à referência.
- Evitar dissolver um personagem sobre a próxima pose, o que cria imagens duplas. Intermediários gerados automaticamente precisam de correção de anatomia, oclusões e contato com objetos.
- Desenhar os quadros adicionais sem executar novamente sons, sorteios, avanço da história ou alterações persistentes. Se a interpolação usar um pequeno atraso de apresentação, compensar o áudio pelo mesmo valor.
- Pausar quando a página estiver oculta e retomar sem acelerar a história.

Meta principal: apresentação estável a 60 fps nos dois monitores e em aparelhos móveis capazes. Em aparelhos limitados, ajustar resolução e efeitos decorativos; permitir 30 fps estáveis quando necessário. Telas de 90/120/144 Hz devem manter a mesma velocidade da história; maior taxa visual será uma melhoria posterior ao fechamento dos 60 fps.

Entrega: movimentos intermediários visíveis, cadência consistente e eventos preservados.

## Etapa 6 — Carregamento e memória

As imagens atuais somam 9.814.936 pixels. Todas abertas simultaneamente em RGBA e ampliadas 4× em cada dimensão ocupariam aproximadamente 599 MiB; em 8×, aproximadamente 2,34 GiB. Esses números não incluem novos quadros, atlas, buffers ou cópias no navegador.

Carregar a qualidade adequada e somente os pacotes da cena atual e das próximas cenas prováveis. Liberar imagens e texturas antigas com cache limitado; carregar e decodificar o próximo pacote antes da transição. Separar cenário compartilhado dos pacotes de personagens para não duplicar recursos.

Definir no piloto limites medidos de download inicial, memória e tempo de quadro para desktop e celular. Não usar o tamanho comprimido do arquivo como estimativa de memória. Medir sessões prolongadas e várias mudanças de capítulo para detectar crescimento acumulado.

O conteúdo necessário deve continuar disponível na execução local sem serviço externo em tempo de reprodução. A publicação permanece estática no GitHub Pages; os arquivos novos devem receber versões para evitar mistura de manifestos e imagens de publicações distintas.

Entrega: transições sem travamento perceptível e memória controlada, com medições registradas.

## Matriz de validação

O enquadramento será calculado para qualquer tamanho; esta lista serve como amostra de testes, sem afirmar cobertura de todo aparelho existente.

| Grupo | Tamanhos representativos |
|---|---|
| Monitores do usuário | 1920×1080 e 2560×1080 |
| Desktop 16:9 | 1280×720, 1366×768, 1600×900, 2560×1440, 3840×2160 |
| Desktop 16:10 | 1280×800, 1920×1200, 2560×1600 |
| Ultrawide | 3440×1440, 3840×1600, 5120×1440 |
| 4:3 e formatos antigos | 1024×768, 1600×1200, 1280×1024 |
| Tablets | 768×1024, 820×1180, 1024×1366 e orientações invertidas |
| Celulares, área CSS | 320×568, 360×800, 390×844, 412×915, 430×932 e orientações invertidas |
| Densidade e frequência | DPR 1, 1,25, 1,5, 2 e 3; apresentação a 30, 60 e 120 Hz |

Os tamanhos de desktop são metas de saída física. No celular, testar também DPR, barras do navegador e área efetivamente visível. Confirmar Chrome/Edge e Firefox no desktop, Chrome no Android e Safari no iOS quando houver acesso a dispositivos reais; registrar separadamente o que tiver sido apenas simulado.

## Critérios de conclusão

- Toda a arte válida possui substituição em alta qualidade, incluindo fundos especiais e desenhos procedurais; a versão final remasterizada não depende de sprites antigos ampliados.
- Todos os registros utilizáveis do catálogo e os 11 capítulos continuam acessíveis; nenhuma sequência foi removida por dificuldade de recriação.
- Tela preenchida com cenário, personagens proporcionais e ações essenciais visíveis nos formatos de teste. Sem barras impostas por uma moldura fixa em 4:3.
- Sem saltos de pivô, halos, tremidas de identidade, membros deformados, imagens duplas ou objetos atravessando camadas incorretamente.
- Mesma duração lógica, ordem de eventos, sons únicos e progressão salva, comparadas com a referência determinística. Não exigir igualdade de pixels entre arte antiga e nova.
- Meta de 60 fps sustentada nos dois monitores, com tempo de quadro e engasgos registrados; desempenho móvel comprovado nos aparelhos testados e adaptação funcional nos demais cenários simulados.
- Executar os testes de gráficos, TTM, ADS e história existentes e acrescentar verificações de transformações, eventos, cobertura de recursos e composição. Rever as expectativas que dependem do renderizador original sem enfraquecer as garantias de comportamento.
- Revisar gravações das sequências e imagens em tamanhos finais, incluindo troca de monitor, rotação, redimensionamento, perda de contexto gráfico e retomada após ocultar a página.
- Conservar execução local e publicar a versão concluída no destino já autorizado, com possibilidade de retornar à versão anterior.

## Ordem de execução e estimativa

Executar catálogo → referências visuais → cena piloto → composição/renderizador HD → produção por famílias + novos movimentos → otimização → revisão integral → publicação.

O piloto deve estabelecer o tempo real para criar, corrigir e revisar uma sequência, o número necessário de intermediários e o tamanho dos pacotes. Só então estimar o trabalho restante por complexidade de cena. O maior esforço previsto é a produção consistente da arte e dos movimentos; a adaptação das dimensões do canvas é uma parcela menor.

Na implementação, os principais pontos de integração serão `web/dist/main.js`, `graphics.js`, `ttm.js`, `story.js`, `ads.js`, `tools/export_web.py` e os verificadores existentes. Criar exportação separada para o acervo HD, para que regenerar a extração dos originais não sobrescreva a arte produzida.
