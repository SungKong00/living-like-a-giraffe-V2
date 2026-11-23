---
number: 1
title: "아키텍처 결정을 MADR로 남긴다"
status: accepted
date: 2026-11-23
---

# 아키텍처 결정을 MADR로 남긴다

## Context and Problem Statement

장기적인 구조 선택의 이유는 개별 변경이 끝난 뒤에도 찾아볼 수 있어야 한다. AI 실습에서 사용한 한국어 작성 방식과 검색 가능한 상태·대체 관계를 V2에서도 유지한다.

## Considered Options

- 선택 이유를 OpenSpec 변경의 설계 문서에 함께 남긴다.
- 여러 변경에 걸쳐 적용되는 선택을 ADR로 관리하고 관련 OpenSpec 변경에서 참조한다.

## Decision Outcome

장기 결정을 MADR 형식으로 이 디렉터리에 기록하고 adrs로 생성·조회한다. 각 변경의 구현 설계와 작업은 OpenSpec에서 관리한다.

### Consequences

- Good, because 이전 결정의 적용 범위와 대체 관계를 찾을 수 있다.
- Bad, because 변경 문서와 결정 문서 사이의 상대 링크를 함께 관리해야 한다.
