# F_Issue 이전 주소 보존 저장소

유가 리포트 운영은 2026-09-07에 `jemjemjemm/daily-energy-dashboard`로 통합되었습니다. 이 저장소는 기존 GitHub Pages 주소의 리다이렉트와 과거 Git 이력 보존만 담당합니다.

## 현재 주소

- 기존 주소: <https://jemjemjemm.github.io/F_Issue/>
- 새 유가 주소: <https://jemjemjemm.github.io/daily-energy-dashboard/oil/>
- 통합 Daily 주소: <https://jemjemjemm.github.io/daily-energy-dashboard/>

기존 루트는 새 유가 주소로 이동합니다. `reports/YYYY-MM-DD-SLOT.html` 형식의 기존 개별 주소도 `data/reports/YYYY-MM-DD-SLOT.json` 선택값을 유지한 채 새 유가 화면으로 이동합니다.

## 자동화 상태

이 저장소에서는 더 이상 데이터를 생성하지 않습니다.

- 기존 `.github/workflows/f-issue-report.yml`: 삭제됨
- 예약 실행: 없음
- push 기반 자동 실행: 없음
- `.github/workflows/redirect-pages.yml`: 리다이렉트 페이지 복구가 필요할 때만 사람이 `workflow_dispatch`로 수동 실행

모든 Daily·유가 데이터 생성과 정기 배포는 `daily-energy-dashboard`에서 수행합니다. 유가 수집 workflow는 다음 파일 하나입니다.

```text
jemjemjemm/daily-energy-dashboard/.github/workflows/oil-report.yml
```

외부 스케줄러나 봇이 과거 workflow를 호출하고 있었다면 저장소와 파일 경로를 위 대상으로 변경해야 합니다. 새 workflow 자체에 08:10·17:10 KST 예약이 있으므로 외부 예약을 중복 등록하지 않습니다.

## 보존 파일

`data/`, `reports/`, 수집 스크립트와 테스트는 과거 이력 확인 및 롤백을 위해 Git 기록에 남아 있습니다. 현재 운영 데이터의 기준으로 사용하거나 이 저장소에서 다시 생성하지 않습니다.

## 배포와 롤백

GitHub Pages Source는 GitHub Actions입니다. 현재 리다이렉트 artifact는 이미 배포됐으며, 이후에는 자동 배포하지 않습니다.

전환 전 기준점, 최신 데이터 보존 기준점, 리다이렉트 병합 커밋과 복구 순서는 [ROLLBACK_POINTS_2026-09-07.md](ROLLBACK_POINTS_2026-09-07.md)에 기록합니다.

리다이렉트만 되돌릴 때는 병합 커밋 `43cea06cebe77de35b05be195b35646578368fce`를 mainline parent 1로 revert하면, 최신 수집 데이터를 포함한 `ab4a1b51759432b782f46e819744ea83d5d9a362` 기준 상태로 돌아갑니다.
