import numpy as np
import networkx as nx
import matplotlib.pyplot as plt
from matplotlib.patches import Circle
import os

np.random.seed(2)

class HyperbolicNetwork:
    def __init__(self, N, gamma, k_bar, zeta=1.0):
        """
        Generate a network in hyperbolic space.
        
        Parameters:
        - N: number of nodes
        - gamma: power-law exponent (must be > 2)
        - k_bar: target average degree
        - zeta: curvature parameter (default 1.0)
        """
        self.N = N
        self.gamma = gamma
        self.k_bar = k_bar
        self.zeta = zeta
        
        # Calculate alpha from gamma: gamma = 2*alpha/zeta + 1
        self.alpha = (gamma - 1) * zeta / 2
        
        # Calculate L from average degree constraint
        # k_bar ≈ (8/π) * N * e^(-zeta*L/2)
        self.L = (2 / zeta) * np.log(8 * N / (np.pi * k_bar))
        
        print(f"Network parameters:")
        print(f"  N = {N}, γ = {gamma}, k̄ = {k_bar}")
        print(f"  α = {self.alpha:.4f}, L = {self.L:.4f}, ζ = {zeta}")
        
        # Generate node coordinates
        self.r, self.theta = self._generate_coordinates()
        
        # Generate network
        self.edges = self._generate_edges()
        self.degrees = self._calculate_degrees()
        
        print(f"Generated network with {len(self.edges)} edges")
        print(f"Average degree: {np.mean(self.degrees):.2f}")
    
    def _generate_coordinates(self):
        """Generate node coordinates (r, theta)"""
        # Radial coordinates from exponential distribution
        # Use inverse CDF sampling
        u = np.random.uniform(0, 1, self.N)
        
        # CDF of ρ(r) is (cosh(αr) - 1) / (cosh(αL) - 1)
        # Inverse: r = (1/α) * arcosh(1 + u*(cosh(αL) - 1))
        r = (1 / self.alpha) * np.arccosh(1 + u * (np.cosh(self.alpha * self.L) - 1))
        
        # Angular coordinates uniformly from [0, 2π)
        theta = np.random.uniform(0, 2 * np.pi, self.N)
        
        return r, theta
    
    def _hyperbolic_distance(self, i, j):
        """Calculate hyperbolic distance between nodes i and j"""
        # Use approximation for large r: x ≈ r_i + r_j + 2*ln(Δθ/2)
        delta_theta = np.abs(self.theta[i] - self.theta[j])
        delta_theta = min(delta_theta, 2 * np.pi - delta_theta)
        
        # Avoid log(0)
        delta_theta = max(delta_theta, 1e-10)
        
        x = self.r[i] + self.r[j] + (2 / self.zeta) * np.log(delta_theta / 2)
        
        return x
    
    def _generate_edges(self):
        """Generate edges using step function connection probability"""
        edges = []
        
        for i in range(self.N):
            for j in range(i + 1, self.N):
                x = self._hyperbolic_distance(i, j)
                
                # Step function: connect if x <= L
                if x <= self.L:
                    edges.append((i, j))
        
        return edges
    
    def _calculate_degrees(self):
        """Calculate degree of each node"""
        degrees = np.zeros(self.N, dtype=int)
        
        for i, j in self.edges:
            degrees[i] += 1
            degrees[j] += 1
        
        return degrees
    
    def to_poincare(self, r, theta):
        """Convert native hyperbolic coordinates to Poincaré disk coordinates"""
        # Use r_e = tanh(r/2) for the Poincaré model
        r_e = np.tanh(r / 2)
        x = r_e * np.cos(theta)
        y = r_e * np.sin(theta)
        return x, y
    
    def plot(self, ax=None, title=None):
        """Plot network using matplotlib"""
        if ax is None:
            fig, ax = plt.subplots(1, 1, figsize=(8, 8))
        
        # Convert coordinates to Poincaré disk
        x, y = self.to_poincare(self.r, self.theta)
        
        # Set up plot
        ax.set_aspect('equal')
        ax.set_xlim(-1.1, 1.1)
        ax.set_ylim(-1.1, 1.1)
        ax.axis('off')
        
        if title:
            ax.set_title(title, fontsize=10, pad=10)
        else:
            ax.set_title(f'Hyperbolic Network (γ={self.gamma}, N={self.N})', 
                        fontsize=10, pad=10)
        
        # Draw Poincaré disk boundary
        boundary = Circle((0, 0), 1, fill=False, edgecolor='lightgray', 
                         linewidth=1, linestyle='--', alpha=0.5)
        ax.add_patch(boundary)
        
        # Calculate node sizes based on degrees (consistent with previous model)
        if np.max(self.degrees) > 0:
            node_sizes = 50 + 400 * (self.degrees / np.max(self.degrees))
        else:
            node_sizes = np.ones(self.N) * 50
        
        # Draw edges
        for i, j in self.edges:
            ax.plot([x[i], x[j]], [y[i], y[j]], 'gray', 
                   linewidth=0.5, alpha=0.3, zorder=1)
        
        # Draw nodes (steel blue like previous model)
        ax.scatter(x, y, s=node_sizes, c='steelblue',
                  alpha=0.7, edgecolors='white', linewidths=0.5, zorder=2)
        
        return ax
    
    def export_tikz(self, filename=None):
        """Export network to TikZ format"""
        # Get the directory where this script is located
        script_dir = os.path.dirname(os.path.abspath(__file__))
        
        if filename is None:
            filename = f'network_{self.gamma:.1f}_{self.N}.tikz'
        
        # Construct full path in the script directory
        filepath = os.path.join(script_dir, filename)
        
        # Convert coordinates to Poincaré disk
        x, y = self.to_poincare(self.r, self.theta)
        
        # Scale node sizes for TikZ (smaller than matplotlib)
        node_sizes = 0.01 + 0.04 * (self.degrees / np.max(self.degrees))
        
        with open(filepath, 'w') as f:
            f.write('\\begin{tikzpicture}[scale=0.95]\n')
            f.write(f'  % Hyperbolic network with gamma = {self.gamma}\n')
            f.write(f'  % N = {self.N}, k_bar = {self.k_bar}\n\n')
            
            # Draw edges
            f.write('  % Edges\n')
            for i, j in self.edges:
                f.write(f'  \\draw[white, line width=0.3pt, opacity=0.2] ({x[i]:.4f},{y[i]:.4f}) -- ({x[j]:.4f},{y[j]:.4f});\n')
            
            f.write('\n  % Nodes\n')
            # Draw nodes
            for i in range(self.N):
                f.write(f'  \\fill[white, opacity=0.5] ({x[i]:.4f},{y[i]:.4f}) circle ({node_sizes[i]:.4f});\n')
            
            f.write('\\end{tikzpicture}\n')
        
        print(f"TikZ code exported to {filepath}")
    
    def analyse_topology(self):
        """Analyse basic topological properties"""
        print("\n=== Network Topology Analysis ===")
        
        # Degree distribution
        print(f"Degree statistics:")
        print(f"  Min degree: {np.min(self.degrees)}")
        print(f"  Max degree: {np.max(self.degrees)}")
        print(f"  Mean degree: {np.mean(self.degrees):.2f}")
        print(f"  Median degree: {np.median(self.degrees):.2f}")
        
        # Clustering (approximate - for small networks)
        if self.N < 1000:
            G = nx.Graph()
            G.add_edges_from(self.edges)
            clustering = nx.average_clustering(G)
            print(f"\nClustering coefficient: {clustering:.4f}")


# Example usage
if __name__ == "__main__":
    # Get the directory where this script is located
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    # Run for different gamma and N values
    gammas = [2.1, 2.5, 3.0]
    N_values = [20, 50, 100, 200, 500]
    k_bar = 2.5
    
    # Create a grid of plots for all networks
    fig, axes = plt.subplots(len(gammas), len(N_values), figsize=(20, 12))
    
    all_networks = []
    
    for gamma_idx, gamma in enumerate(gammas):
        for n_idx, N in enumerate(N_values):
            print(f"\n{'='*50}")
            print(f"Generating network with γ={gamma}, N={N}")
            
            net = HyperbolicNetwork(N=N, gamma=gamma, k_bar=k_bar)
            net.analyse_topology()
            net.export_tikz(f"network_{gamma}_{N}.tikz")
            
            # Plot in the grid
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
