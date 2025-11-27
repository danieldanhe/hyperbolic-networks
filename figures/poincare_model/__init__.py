import numpy as np
import matplotlib.pyplot as plt
import os

class HyperbolicNetwork:
    def __init__(self, N, gamma, k_bar, beta):
        self.N = N
        self.gamma = gamma
        self.k_bar = k_bar
        self.beta = beta
        
        self.alpha = (gamma - 1) / 2
        self.L = 2 * np.log(((2 * N) / (np.pi * k_bar)) * ((gamma - 1) / (gamma - 2)) ** 2)
        
        print(f"Network parameters:")
        print(f"  N = {N}, γ = {gamma}, k̄ = {k_bar}, β = {beta}")
        print(f"  α = {self.alpha:.4f}, L = {self.L:.4f}")
        
        self.r, self.theta = self._generate_coordinates()
        
        self.edges = self._generate_edges()
        self.degrees = self._calculate_degrees()
        
        print(f"Generated network with {len(self.edges)} edges")
        print(f"Average degree: {np.mean(self.degrees):.2f}")
    
    def _generate_coordinates(self):
        u = np.random.uniform(0, 1, self.N)
        
        r = (1 / self.alpha) * np.arccosh(1 + (np.cosh(self.alpha * self.L) - 1) * u)
        
        theta = np.random.uniform(0, 2 * np.pi, self.N)
        
        return r, theta
        
    
    def _hyperbolic_distance(self, i, j):
        delta_theta = np.abs(self.theta[i] - self.theta[j])
        delta_theta = min(delta_theta, 2 * np.pi - delta_theta)
                
        x = np.arccosh(np.clip((
            (np.cosh(self.r[i]) * np.cosh(self.r[j])) -
            (np.sinh(self.r[i]) * np.sinh(self.r[j]) * np.cos(delta_theta))
        ), 1, None))
        
        return x
    
    def _generate_edges(self):
        edges = []
        
        for i in range(self.N):
            for j in range(i + 1, self.N):
                x = self._hyperbolic_distance(i, j)
                u = np.random.uniform(0, 1)

                probability = 1 / (np.exp(self.beta * (x - self.L) / 2) + 1)
                
                if u < probability:
                    edges.append((i, j))
    
        return edges
    
    def _calculate_degrees(self):
        degrees = np.zeros(self.N, dtype=int)
        
        for i, j in self.edges:
            degrees[i] += 1
            degrees[j] += 1
        
        return degrees
    
    def to_poincare(self, r, theta):
        r_e = np.tanh(r / 2)
        x = r_e * np.cos(theta)
        y = r_e * np.sin(theta)
        return x, y
    
    def plot(self, ax=None, title=None):
        if ax is None:
            fig, ax = plt.subplots(1, 1, figsize=(8, 8))
        
        x, y = self.to_poincare(self.r, self.theta)
        
        ax.set_aspect('equal')
        ax.set_xlim(-1.1, 1.1)
        ax.set_ylim(-1.1, 1.1)
        ax.axis('off')
        
        if title:
            ax.set_title(title, fontsize=10, pad=10)
        else:
            ax.set_title(f'Hyperbolic Network (γ={self.gamma}, N={self.N})', 
                        fontsize=10, pad=10)
                
        if np.max(self.degrees) > 0:
            node_sizes = 50 + 400 * (self.degrees / np.max(self.degrees))
        else:
            node_sizes = np.ones(self.N) * 50
        
        for i, j in self.edges:
            ax.plot([x[i], x[j]], [y[i], y[j]], 'gray', 
                   linewidth=0.5, alpha=0.3, zorder=1)
        
        ax.scatter(x, y, s=node_sizes, c='steelblue',
                  alpha=0.7, edgecolors='white', linewidths=0.5, zorder=2)
        
        return ax
    
    def export_tikz(self, filename):
        script_dir = os.path.dirname(os.path.abspath(__file__))
                
        filepath = os.path.join(script_dir, filename)
        
        x, y = self.to_poincare(self.r, self.theta)
        
        node_sizes = 0.01 + 0.04 * (self.degrees / np.max(self.degrees))
        
        with open(filepath, 'w') as f:
            f.write('\\begin{tikzpicture}[scale=0.85]\n')
            f.write(f'  % Hyperbolic network with gamma = {self.gamma}\n')
            f.write(f'  % N = {self.N}, k_bar = {self.k_bar}\n\n')
            
            f.write('  % Edges\n')
            for i, j in self.edges:
                f.write(f'  \\draw[white, line width=0.3pt, opacity=0.2] ({x[i]:.4f},{y[i]:.4f}) -- ({x[j]:.4f},{y[j]:.4f});\n')
            
            f.write('\n  % Nodes\n')

            for i in range(self.N):
                f.write(f'  \\fill[white, opacity=0.5] ({x[i]:.4f},{y[i]:.4f}) circle ({node_sizes[i]:.4f});\n')
            
            f.write('\\end{tikzpicture}\n')
        
        print(f"TikZ code exported to {filepath}")
