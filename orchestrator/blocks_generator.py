"""
Генерация state.blocks из реального pipeline_graph.

Дашборд рисует UI по state.blocks (декларативные группы агентов с зависимостями).
Когда orchestrator динамически расширяет pipeline_graph (после Pipeline Architect),
блоки нужно пересоздать, иначе UI покажет всех новых агентов в одной куче.

Источник правды для группировки — DEFAULT_BLOCKS из config.py.
Берём только те блоки, в которых есть хотя бы один реально присутствующий агент.
"""

from typing import Dict, List, Any, Set

from config import DEFAULT_BLOCKS


def regenerate_blocks_from_graph(state: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Возвращает новый список блоков для записи в state.blocks.

    - Берём DEFAULT_BLOCKS как шаблон порядка/именования.
    - Для каждого блока оставляем пересечение его агентов с реальным графом.
    - Edges урезаем до пар, где обе стороны попали в блок.
    - Пустые блоки выбрасываем.
    - Зависимости между блоками сохраняем, но фильтруем по фактическому существованию.
    """
    graph = state.get("pipeline_graph", {})
    actual_nodes: Set[str] = set(graph.get("nodes", []))
    actual_edges: List[List[str]] = graph.get("edges", [])

    blocks: List[Dict[str, Any]] = []
    kept_block_ids: Set[str] = set()

    for tpl in DEFAULT_BLOCKS:
        agents_in_block = [a for a in tpl["agents"] if a in actual_nodes]
        if not agents_in_block:
            continue

        # Edges: внутри блока — из шаблона + дополнительно из реального графа
        agent_set = set(agents_in_block)
        edges_in_block: List[List[str]] = []
        for e in tpl.get("edges", []):
            if e[0] in agent_set and e[1] in agent_set:
                edges_in_block.append([e[0], e[1]])
        for e in actual_edges:
            if e[0] in agent_set and e[1] in agent_set and [e[0], e[1]] not in edges_in_block:
                edges_in_block.append([e[0], e[1]])

        kept_block_ids.add(tpl["id"])
        blocks.append({
            "id": tpl["id"],
            "name": tpl["name"],
            "description": tpl.get("description", ""),
            "agents": agents_in_block,
            "edges": edges_in_block,
            "depends_on": [d for d in tpl.get("depends_on", []) if d in kept_block_ids or d in {b["id"] for b in blocks}],
            "requires_approval": bool(tpl.get("requires_approval", False)),
        })

    # Финальная фильтрация depends_on: только на блоки, которые реально остались
    final_ids = {b["id"] for b in blocks}
    for b in blocks:
        b["depends_on"] = [d for d in b["depends_on"] if d in final_ids]

    return blocks
