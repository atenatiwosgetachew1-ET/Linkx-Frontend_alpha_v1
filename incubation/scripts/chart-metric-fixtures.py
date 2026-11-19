# Reference values for the Chart window metrics (G5), from networkx.
# Usage: python3 scripts/chart-metric-fixtures.py <dir with networkx> src/features/chart/lib/__fixtures__/chartMetrics.networkx.json
# (networkx 3.4.2, pure Python; e.g. its wheel unpacked into a folder). Dev only, not shipped.
import json, sys
sys.path.insert(0, sys.argv[1])
import networkx as nx

def karate():
    g = nx.karate_club_graph()
    nodes = [f"k{n}" for n in g.nodes()]
    edges = [{"key": f"e{i}", "source": f"k{min(a,b)}", "target": f"k{max(a,b)}"} for i, (a, b) in enumerate(g.edges())]
    return nodes, edges

def crafted():
    nodes = ["a", "b", "c", "d", "e", "f", "g", "h", "x"]  # x isolated
    pairs = [("a","b"),("a","b"),("b","a"),("b","c"),("c","a"),("c","d"),("d","e"),("e","c"),("c","c"),
             ("f","g"),("g","h"),("h","f"),("f","h")]
    edges = [{"key": f"e{i}", "source": s, "target": t} for i, (s, t) in enumerate(pairs)]
    return nodes, edges

def simple(nodes, edges):
    g = nx.Graph(); g.add_nodes_from(nodes)
    g.add_edges_from((e["source"], e["target"]) for e in edges if e["source"] != e["target"])
    return g

def directed(nodes, edges):
    # Directed metrics: each pair's direction once, no self links.
    d = nx.DiGraph(); d.add_nodes_from(nodes)
    d.add_edges_from((e["source"], e["target"]) for e in edges if e["source"] != e["target"])
    return d

def ego(g):
    size, density = {}, {}
    for n in g.nodes():
        e = nx.ego_graph(g, n, radius=1)
        size[n] = e.number_of_nodes()
        density[n] = nx.density(e)
    return size, density

def references(nodes, edges):
    multi = nx.MultiGraph(); multi.add_nodes_from(nodes); multi.add_edges_from((e["source"], e["target"]) for e in edges)
    mdi = nx.MultiDiGraph(); mdi.add_nodes_from(nodes); mdi.add_edges_from((e["source"], e["target"]) for e in edges)
    g = simple(nodes, edges)
    n = len(nodes)
    harmonic = nx.harmonic_centrality(g)
    eig = nx.eigenvector_centrality(g, max_iter=5000, tol=1e-12)
    top = max(eig.values())
    return {
        "degree": dict(multi.degree()),
        "in": dict(mdi.in_degree()),
        "out": dict(mdi.out_degree()),
        "betweenness": nx.betweenness_centrality(g, normalized=True),
        "closeness": {k: (v / (n - 1) if n > 1 else 0) for k, v in harmonic.items()},
        "eigenvector": {k: (v / top if g.degree(k) else 0) for k, v in eig.items()},
        **g52(nodes, edges, g),
    }

def g52(nodes, edges, g):
    from networkx.algorithms.link_analysis.pagerank_alg import _pagerank_python
    from networkx.algorithms.link_analysis.hits_alg import _hits_python
    d = directed(nodes, edges)
    hubs, auths = _hits_python(d, max_iter=10000, tol=1e-14)
    size, density = ego(g)
    constraint = {k: v for k, v in nx.constraint(g).items() if v == v}  # isolated: nan, left out
    return {
        "pagerank": _pagerank_python(d, alpha=0.85, max_iter=10000, tol=1e-14),
        "hubs": hubs,
        "authorities": auths,
        "clustering": nx.clustering(g),
        "constraint": constraint,
        "egoSize": size,
        "egoDensity": density,
        "kcore": nx.core_number(g),
        **g53(edges, g),
        **g54(nodes, edges, g),
        "temporal": g55(nodes, edges),
    }

def day_of(nodes, index):
    # Each link's day (0 = the first); the tests date it at local noon.
    if nodes[0].startswith("k"):
        return index % 10
    return [0, 0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 7, 7][index]

def g55(nodes, edges):
    partition = partition_of(nodes)
    days = [day_of(nodes, i) for i in range(len(edges))]
    periods = list(range(min(days), max(days) + 1))
    out = {"days": days, "entityChurn": [], "linkChurn": [], "density": [], "centralization": [], "modularity": [], "links": []}
    last_nodes, last_pairs = None, None
    for day in periods:
        mine = [e for e, d in zip(edges, days) if d == day]
        active = {e["source"] for e in mine} | {e["target"] for e in mine}
        pairs = {frozenset((e["source"], e["target"])) for e in mine if e["source"] != e["target"]}
        g = nx.Graph(); g.add_nodes_from(active); g.add_edges_from(tuple(p) for p in pairs)
        n = len(active)
        out["links"].append(len(mine))
        if n:
            out["density"].append(nx.density(g))
            degrees = dict(g.degree())
            top = max(degrees.values())
            out["centralization"].append(sum(top - v for v in degrees.values()) / ((n - 1) * (n - 2)) if n > 2 else 0)
            groups = [sorted(set(c) & active) for c in partition]
            groups = [c for c in groups if c]
            placed = {x for c in groups for x in c}
            groups += [[x] for x in sorted(active - placed)]
            out["modularity"].append(nx.community.modularity(g, groups) if g.number_of_edges() else None)
        else:
            out["density"].append(None); out["centralization"].append(None); out["modularity"].append(None)
        def churn(now, before):
            if before is None:
                return None
            union = now | before
            return len(now ^ before) / len(union) if union else None
        out["entityChurn"].append(churn(active, last_nodes))
        out["linkChurn"].append(churn(pairs, last_pairs))
        last_nodes, last_pairs = active, pairs
    return out

def partition_of(nodes):
    # A fixed grouping for modularity (the app's own communities come from
    # the Graph window's detection): karate by club, crafted by part.
    if nodes[0].startswith("k"):
        club = nx.karate_club_graph().nodes(data="club")
        groups = {}
        for n, c in club:
            groups.setdefault(c, []).append(f"k{n}")
        return sorted(groups.values())
    return [["a", "b", "c", "d", "e"], ["f", "g", "h"], ["x"]]

def g54(nodes, edges, g):
    n = len(nodes)
    d = directed(nodes, edges)
    multi = nx.MultiGraph(); multi.add_nodes_from(nodes); multi.add_edges_from((e["source"], e["target"]) for e in edges)
    distances = [l for u, ls in nx.all_pairs_shortest_path_length(g) for v, l in ls.items() if u != v]
    # Newman's degree assortativity: Pearson correlation of the end degrees
    # over every link both ways (networkx's needs numpy; same definition).
    import statistics
    xs, ys = [], []
    for u, v in g.edges():
        xs += [g.degree(u), g.degree(v)]; ys += [g.degree(v), g.degree(u)]
    try:
        assort = statistics.correlation(xs, ys) if xs else float("nan")
    except statistics.StatisticsError:
        assort = float("nan")
    per_node = {k: v for k, v in nx.reciprocity(d, d.nodes()).items() if v is not None}
    parts = list(nx.connected_components(g))
    partition = partition_of(nodes)
    degrees = dict(g.degree())
    top = max(degrees.values())
    groups = [c for c in partition if len(c) > 1]
    return {
        "global": {
            "nodes": n,
            "links": len(edges),
            "density": nx.density(g),
            "averageDegree": sum(dict(multi.degree()).values()) / n,
            "averagePathLength": sum(distances) / len(distances) if distances else 0,
            "diameter": max(distances) if distances else 0,
            "averageClustering": nx.average_clustering(g),
            "transitivity": nx.transitivity(g),
            "assortativity": None if assort != assort else assort,
            "reciprocity": nx.overall_reciprocity(d),
        },
        "reciprocityByNode": per_node,
        "partition": partition,
        "cohesion": {
            "components": len(parts),
            "largestComponentRatio": max(len(c) for c in parts) / n,
            "bridges": len(list(nx.bridges(g))),
            "cutVertices": len(list(nx.articulation_points(g))),
            "modularity": nx.community.modularity(g, partition),
            "communities": len(partition),
            "communityDensity": sum(nx.density(g.subgraph(c)) for c in groups) / len(groups) if groups else 0,
            "centralization": sum(top - v for v in degrees.values()) / ((n - 1) * (n - 2)) if n > 2 else 0,
        },
    }

def g53(edges, g):
    # Per link (parallel links share their pair's value); self links have none.
    eb = nx.edge_betweenness_centrality(g, normalized=True)
    pair = lambda u, v: eb.get((u, v), eb.get((v, u)))
    out = {"edgeBetweenness": {}}
    for e in edges:
        u, v = e["source"], e["target"]
        if u == v:
            continue
        out["edgeBetweenness"][e["key"]] = pair(u, v)
    return out

out = {"generator": f"networkx {nx.__version__}", "graphs": {}}
for name, build in [("karate", karate), ("crafted", crafted)]:
    nodes, edges = build()
    out["graphs"][name] = {"nodes": nodes, "edges": edges, "expected": references(nodes, edges)}
json.dump(out, open(sys.argv[2], "w"), indent=1, sort_keys=True)
print("ok", {k: len(v["nodes"]) for k, v in out["graphs"].items()})
