import numpy as np
import matplotlib.pyplot as plt
import os

from . import HyperbolicNetwork

np.random.seed(256)

if __name__ == "__main__":
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    gammas = [2.1, 2.5, 3.0]
    N_values = [20, 50, 100, 200, 500]
    k_bar = 10
    
    fig, axes = plt.subplots(len(gammas), len(N_values), figsize=(20, 12))
    
    all_networks = []
    
    for gamma_idx, gamma in enumerate(gammas):
        for n_idx, N in enumerate(N_values):
            print(f"\n{'='*50}")
            
            net = HyperbolicNetwork(N=N, gamma=gamma, k_bar=k_bar)
            net.export_tikz(f"network_gamma_{gamma}_{N}.tikz")
            
            ax = axes[gamma_idx, n_idx]
            net.plot(ax=ax, title=f'γ={gamma}, N={N}')
            
            all_networks.append((gamma, N, net))
    
    plt.tight_layout()
    output_path = os.path.join(script_dir, "models.png")
    plt.savefig(output_path, dpi=300, bbox_inches='tight')
    print(f"\n{'='*50}")
    print(f"Comparison plot saved to: {output_path}")
    print(f"Generated {len(all_networks)} networks in total")
    plt.show()
