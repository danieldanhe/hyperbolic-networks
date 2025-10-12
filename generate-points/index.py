import numpy as np
import networkx as nx
from collections import defaultdict
import os

# Get the directory where this script is located
script_dir = os.path.dirname(os.path.abspath(__file__))

def generate_erdos_renyi(n=60, m=120):
    """Low clustering, low heterogeneity: Random graph"""
    G = nx.gnm_random_graph(n, m)
    pos = {i: (np.random.random(), np.random.random()) for i in range(n)}
    return G, pos

def generate_barabasi_albert(n=60, m=2):
    """Low clustering, high heterogeneity: Preferential attachment"""
    G = nx.barabasi_albert_graph(n, m)
    # Use spring layout for better hub visualization
    pos = nx.spring_layout(G, iterations=50)
    # Normalize to [0,1]
    x_coords = [pos[i][0] for i in range(n)]
    y_coords = [pos[i][1] for i in range(n)]
    x_min, x_max = min(x_coords), max(x_coords)
    y_min, y_max = min(y_coords), max(y_coords)
    pos = {i: ((pos[i][0]-x_min)/(x_max-x_min), (pos[i][1]-y_min)/(y_max-y_min)) 
           for i in range(n)}
    return G, pos

def generate_watts_strogatz(n=60, k=5, p=0.1):
    """High clustering, low heterogeneity: Small-world"""
    G = nx.watts_strogatz_graph(n, k, p)
    # Grid layout to show local structure
    grid_size = int(np.ceil(np.sqrt(n)))
    pos = {}
    for i in range(n):
        row = i // grid_size
        col = i % grid_size
        pos[i] = (col / grid_size + np.random.uniform(-0.05, 0.05), 
                  row / grid_size + np.random.uniform(-0.05, 0.05))
    return G, pos

def generate_hyperbolic_proxy(n=60, m=120):
    """High clustering, high heterogeneity: Modular network with hubs"""
    G = nx.Graph()
    G.add_nodes_from(range(n))
    
    # Create 4-5 hubs
    n_hubs = 5
    hubs = list(range(n_hubs))
    regular_nodes = list(range(n_hubs, n))
    
    # Position nodes randomly but spread out
    pos = {}
    for i in range(n):
        pos[i] = (np.random.random(), np.random.random())
    
    edges_added = 0
    target_edges = m
    
    # Each hub connects to many nodes (high heterogeneity)
    for hub in hubs:
        # Connect hub to 8-12 random nodes
        n_connections = np.random.randint(8, 13)
        targets = np.random.choice(regular_nodes, size=min(n_connections, len(regular_nodes)), replace=False)
        for target in targets:
            if edges_added < target_edges:
                G.add_edge(hub, target)
                edges_added += 1
    
    # Connect hubs to each other
    for i in range(len(hubs)):
        for j in range(i+1, len(hubs)):
            if edges_added < target_edges and np.random.random() < 0.6:
                G.add_edge(hubs[i], hubs[j])
                edges_added += 1
    
    # Create triangles and local clustering among regular nodes
    # Group nodes by proximity to create local clusters
    while edges_added < target_edges:
        # Pick a random node
        node = np.random.choice(regular_nodes)
        # Find its neighbors
        neighbors = list(G.neighbors(node))
        
        if len(neighbors) >= 2:
            # Create triangles: connect pairs of neighbors
            n1, n2 = np.random.choice(neighbors, size=2, replace=False)
            if not G.has_edge(n1, n2):
                G.add_edge(n1, n2)
                edges_added += 1
                continue
        
        # Otherwise add edge to nearby node (spatial clustering)
        if len(neighbors) < 6:  # Don't overconnect
            distances = [(other, np.sqrt((pos[node][0]-pos[other][0])**2 + 
                                        (pos[node][1]-pos[other][1])**2)) 
                        for other in regular_nodes if other != node and not G.has_edge(node, other)]
            if distances:
                distances.sort(key=lambda x: x[1])
                # Connect to one of the 10 nearest nodes
                candidates = [d[0] for d in distances[:10]]
                if candidates:
                    target = np.random.choice(candidates)
                    G.add_edge(node, target)
                    edges_added += 1
                    continue
        
        # Fallback: random edge
        available_pairs = [(i, j) for i in range(n) for j in range(i+1, n) 
                          if not G.has_edge(i, j)]
        if available_pairs:
            i, j = available_pairs[np.random.randint(len(available_pairs))]
            G.add_edge(i, j)
            edges_added += 1
    
    return G, pos

def to_tikz(G, pos, title):
    """Convert graph to TikZ code with node sizes scaled by degree"""
    tikz = f"% {title}\n"
    tikz += "\\begin{tikzpicture}[scale=2.5]\n"
    
    # Calculate node sizes based on degrees (like in hyperbolic network)
    degrees = [d for _, d in G.degree()]
    if max(degrees) > 0:  # Avoid division by zero
        node_sizes = 0.01 + 0.04 * (np.array(degrees) / max(degrees))
    else:
        node_sizes = [0.01] * len(degrees)
    
    # Draw edges
    for u, v in G.edges():
        x1, y1 = pos[u]
        x2, y2 = pos[v]
        tikz += f"  \\draw[white, line width=0.3pt, opacity=0.2] ({x1:.4f},{y1:.4f}) -- ({x2:.4f},{y2:.4f});\n"
    
    # Draw nodes with size proportional to degree
    for i, node in enumerate(G.nodes()):
        x, y = pos[node]
        size = node_sizes[i]
        tikz += f"  \\fill[white, opacity=0.5] ({x:.4f},{y:.4f}) circle ({size:.4f});\n"
    
    tikz += "\\end{tikzpicture}\n"
    return tikz

# Generate all four networks
networks = [
    ("low_clust_low_hetero", "Low Clustering, Low Heterogeneity (Erdős-Rényi)", 
     generate_erdos_renyi(n=60, m=120)),
    ("low_clust_high_hetero", "Low Clustering, High Heterogeneity (Barabási-Albert)", 
     generate_barabasi_albert(n=60, m=2)),
    ("high_clust_low_hetero", "High Clustering, Low Heterogeneity (Watts-Strogatz)", 
     generate_watts_strogatz(n=60, k=5, p=0.1)),
    ("high_clust_high_hetero", "High Clustering, High Heterogeneity (Modular with Hubs)", 
     generate_hyperbolic_proxy(n=60, m=120))
]

print("Generating networks and saving to files...")
print("=" * 60)

for filename, title, (G, pos) in networks:
    print(f"\n{title}")
    print(f"Nodes: {G.number_of_nodes()}, Edges: {G.number_of_edges()}")
    print(f"Avg Clustering: {nx.average_clustering(G):.3f}")
    
    degrees = [d for _, d in G.degree()]
    degree_heterogeneity = np.std(degrees) / np.mean(degrees) if np.mean(degrees) > 0 else 0
    print(f"Degree heterogeneity (std/mean): {degree_heterogeneity:.3f}")
    print(f"Degree range: {min(degrees)} - {max(degrees)}")
    
    # Save to file
    tikz_code = to_tikz(G, pos, title)
    output_file = os.path.join(script_dir, f"{filename}.tikz")
    with open(output_file, 'w') as f:
        f.write(tikz_code)
    print(f"Saved to: {output_file}")

print("\n" + "=" * 60)
print("All networks generated and saved successfully!")
