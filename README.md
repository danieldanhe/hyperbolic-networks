# hyperbolic-networks

Final project for AT Post-Euclidean Geometry exploring the connection between hyperbolic geometry and complex network structure.

## Implementation notes

* Slides are made with a custom class, [`presentation.cls`](https://gist.github.com/danieldanhe/6ae42535e04d53d51e96ce9801be57a2), from me.
* You must run [`generate-points/index.py`](generate-points/index.py) and [`poincare-model/index.py`](poincare-model/index.py) to generate the PGF/TikZ files required in the presentation. These are generic models of networks with low and high heterogeneity and clustering, and networks generated on a Poincaré disc (as specified in Krioukov et al. 2010) with different values of $N$ at $\gamma$, respectively.
* Tilings – [{3,7}](https://commons.wikimedia.org/wiki/File:Order-7_triangular_tiling.svg), [{4,5}](https://commons.wikimedia.org/wiki/File:H2-5-4-primal.svg), and [{5,4}](https://commons.wikimedia.org/wiki/File:H2-5-4-dual.svg) – are modified and converted to PDF from public-domain files from Wikimedia Commons.
