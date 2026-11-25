"""Classify a Blender material from its active Cycles output."""


def live_shader(socket, groups=()):
    """Follow shader links from the active output, including nested shader groups."""
    for link in socket.links:
        node = link.from_node
        output = link.from_socket
        if node.mute:
            sources = [
                edge.from_socket
                for edge in node.internal_links
                if edge.to_socket == output
            ]
        elif node.type == "GROUP" and node.node_tree:
            end = next(
                (
                    n
                    for n in node.node_tree.nodes
                    if n.type == "GROUP_OUTPUT" and n.is_active_output
                ),
                None,
            )
            if end and any(
                live_shader(s, (*groups, node))
                for s in end.inputs
                if s.identifier == output.identifier
            ):
                return True
            continue
        elif node.type == "GROUP_INPUT" and groups:
            if any(
                live_shader(s, groups[:-1])
                for s in groups[-1].inputs
                if s.identifier == output.identifier
            ):
                return True
            continue
        elif node.type in {"BSDF_GLASS", "BSDF_TRANSPARENT", "BSDF_REFRACTION"}:
            return True
        elif node.type == "BSDF_PRINCIPLED":
            transmission, alpha = (
                node.inputs["Transmission Weight"],
                node.inputs["Alpha"],
            )
            if (
                transmission.is_linked
                or transmission.default_value > 0
                or alpha.is_linked
                or alpha.default_value < 1
            ):
                return True
            continue
        else:
            sources = [
                s for s in node.inputs if s.type == "SHADER" or node.type == "REROUTE"
            ]
        if any(live_shader(s, groups) for s in sources):
            return True
    return False


def surface_kind(material):
    if material and material.use_nodes:
        output = material.node_tree.get_output_node("CYCLES")
        if output:
            surface = output.inputs["Surface"]
            if not surface.is_linked and output.inputs["Volume"].is_linked:
                return "volume"
            if live_shader(surface):
                return "live"
    return "bake"
