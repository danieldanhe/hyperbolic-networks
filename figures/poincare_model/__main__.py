import numpy as np
import matplotlib.pyplot as plt
import os

from . import HyperbolicNetwork

np.random.seed(256)

if __name__ == "__main__":
    script_dir = os.path.dirname(os.path.abspath(__file__))

    N_values = [20, 50, 100, 200, 500]
    
    gammas = [2.1, 2.5, 3.0]
    
    betas = [0.5, 1.0, 2.0]
    
    fig1, axes1 = plt.subplots(len(gammas), len(N_values), figsize=(20, 12))
    
    all_networks = []
    
    for gamma_idx, gamma in enumerate(gammas):
        for n_idx, N in enumerate(N_values):
            print(f"\n{'='*50}")
            
            net = HyperbolicNetwork(N=N, gamma=gamma, k_bar=20, beta=np.inf)
            net.export_tikz(f"network_gamma_{gamma}_{N}.tikz")
            
            ax = axes1[gamma_idx, n_idx]
            net.plot(ax=ax, title=f'γ={gamma}, N={N}')
            
            all_networks.append((gamma, N, net))
    
    plt.tight_layout()
    output_path1 = os.path.join(script_dir, "models_gamma.png")
    plt.savefig(output_path1, dpi=300, bbox_inches='tight')
    print(f"\n{'='*50}")
    print(f"Gamma comparison plot saved to: {output_path1}")
    
    fig2, axes2 = plt.subplots(len(betas), len(N_values), figsize=(20, 12))
    
    beta_networks = []
    
    for beta_idx, beta in enumerate(betas):
        for n_idx, N in enumerate(N_values):
            print(f"\n{'='*50}")
            
            net = HyperbolicNetwork(N=N, gamma=2.1, k_bar=20, beta=beta)
            net.export_tikz(f"network_beta_{beta}_{N}.tikz")
            
            ax = axes2[beta_idx, n_idx]
            net.plot(ax=ax, title=f'β={beta}, N={N}')
            
            beta_networks.append((2.1, beta, N, net))
    
    plt.tight_layout()
    output_path2 = os.path.join(script_dir, "models_beta.png")
    plt.savefig(output_path2, dpi=300, bbox_inches='tight')
    print(f"\n{'='*50}")
    print(f"Beta comparison plot saved to: {output_path2}")
    print(f"Generated {len(all_networks)} gamma-varied networks")
    print(f"Generated {len(beta_networks)} beta-varied networks")
    
    plt.show()
