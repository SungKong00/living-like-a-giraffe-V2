---
name: riragi-blender
description: Use for inspecting, editing, or exporting the Riragi world source in Blender, including room transforms, glTF extras, and export validation.
---

# 리라지 월드의 Blender 작업

- 작업할 장면과 원본 팩의 사용 조건을 [월드 자산](../../../docs/world/README.md)에서 확인한다. 전체 장면을 편집할 때는 별도 작업본을 만들어 원본 팩과 구별한다.
- 열려 있는 장면을 다룰 때는 Blender Lab MCP의 오브젝트 요약으로 대상 장면과 계층을 확인한다. 애드온 브리지가 연결되어야 장면을 읽을 수 있다. 도구 목록만 보이면 [공식 연결 절차](https://projects.blender.org/lab/blender_mcp/wiki/Setup.md)를 확인한다. 연결 없이 파일 단위 검사나 내보내기가 가능하면 로컬 Blender의 백그라운드 모드를 사용한다.
- 웹용 GLB를 내보낼 때는 사용 중인 매핑 명세에서 기준점 ID와 좌표계 계약을 먼저 확인한다. 매핑에 사용되는 기준점이 있으면 내보낸 결과의 ID와 변환을 확인한다. 최적화가 이어지면 그 결과에서도 동일한 계약을 검증한다. [Blender glTF 매뉴얼](https://docs.blender.org/manual/en/latest/addons/import_export/scene_gltf2.html)
