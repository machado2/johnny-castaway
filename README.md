# Johnny Castaway no navegador

Versão web feita por análise direta de `SCRANTIC.SCR`, `RESOURCE.MAP` e `RESOURCE.001` fornecidos neste projeto. O motor é JavaScript e a página tem somente um canvas. Não executa o programa Win16, não inclui DOSBox, Windows, emulador de CPU ou código de outra reimplementação.

## Abrir

Execute `npm start` nesta pasta e abra [http://127.0.0.1:4173](http://127.0.0.1:4173).

Na execução local, o servidor escuta apenas em `127.0.0.1`, e a animação carrega imagens, roteiros e sons da própria pasta, sem depender de internet ou login. A publicação autorizada usa GitHub Pages em [castaway.fbmac.net](https://castaway.fbmac.net).

A animação começa automaticamente. Toque ou clique no canvas uma vez para liberar os sons, conforme a exigência de reprodução de áudio do navegador, inclusive no celular. O toque também funciona durante o carregamento; os efeitos começam quando os arquivos estiverem prontos e a cena solicitar um som. A história fica salva no armazenamento local do navegador. Os quadros usam a resolução original de 640 × 480 e ocupam o maior espaço possível da janela, sem suavização e preservando a proporção de 4:3.

## O que foi reconstruído

- Os 180 recursos do arquivo original foram indexados e conferidos contra `RESOURCE.MAP`.
- 127 arquivos de imagem, com 2.402 desenhos/imagens, foram descomprimidos sem redesenhar a arte.
- Os 41 roteiros TTM contêm 6.631 quadros e 611 sequências. Todos os 30 tipos de instrução presentes foram implementados.
- Os dez arquivos ADS contêm 66 programas de cena, com animações concorrentes, condições, escolhas ponderadas, repetições e espera por eventos.
- O catálogo do executável contém 80 registros: um inicial vazio e 79 utilizáveis, incluindo ações, caminhadas e os 11 capítulos.
- Os caminhos de caminhada, as tabelas aleatórias, as posições, a composição do cenário e as datas especiais foram extraídos do executável.
- Os 23 efeitos PCM foram extraídos dos recursos NE e associados pelos nomes WAVESFX originais.

Os documentos em `analysis/` registram os endereços do executável que fundamentam a reconstrução:

- `ttm-findings.md`: instruções de desenho, temporização e persistência do fundo.
- `ads-findings.md`: coordenação de animações e controle dos programas de cena.
- `story-findings.md`: seleção de cenas, calendário, caminhos e ambiente.
- `original-inventory.json`: estrutura NE, arquivos, tamanhos e recursos.

## Reproduzir a extração e validar

Requer Python com Pillow para a extração; o motor web e os testes usam somente Node.js, sem dependências npm. Capstone é necessário apenas para regenerar a desmontagem com `python tools/disassemble.py`.

```text
npm run extract
npm test
```

`tools/gdi_masks.py` permite regenerar no Windows as máscaras dos círculos usados pelo programa. Ele chama o GDI em uma imagem fora da tela, sem executar o screensaver; as máscaras já ficam preservadas em `analysis/gdi-circle-masks.json`.

## Precisão e limites verificados

A validação percorre os roteiros e as cenas originais, verifica transições, efeitos sonoros, caminhos e persistência do cenário. Não foi realizado um comparativo de vídeo quadro a quadro com o programa rodando em Windows 3.1; essa equivalência visual integral não está comprovada.

O original solicita `SetTimer(...,50,...)`. A apresentação usa passos de 55 ms para reproduzir aproximadamente a granularidade do Windows 3.1, separadamente dos contadores de 16 ms encontrados no executável. A limitação histórica do sistema está documentada no artigo original da Microsoft [Q81592](https://jeffpar.github.io/kbarchive/kb/081/Q81592/).

Os círculos usam máscaras obtidas do GDI disponível neste Windows; diferenças entre esse GDI e o Win16 de 1992 não foram medidas. Retas usam rasterização inteira sem suavização. O canvas é recomposto integralmente, em vez de depender dos retângulos de atualização do Windows.

Há referências a desenhos inexistentes nos próprios dados originais. O executável usa um sentinela nulo quando o índice é igual à quantidade de desenhos e, em alguns casos, lê além da tabela. A versão web omite essas referências inválidas e as registra no diagnóstico, sem inventar desenhos nem reproduzir acessos indevidos à memória.

O navegador suspende a animação quando a página fica oculta; ao voltar, a cena continua. A detecção de data e a escolha de período são reavaliadas entre blocos de cenas, como no programa original.

A arte, os roteiros e os sons extraídos continuam sendo conteúdo do software original Sierra/Dynamix. O código desta versão é separado desses arquivos; os arquivos binários fornecidos foram preservados.
