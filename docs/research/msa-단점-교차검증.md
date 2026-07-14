# MSA(마이크로서비스 아키텍처) 단점·한계 교차검증 자료

> **목적**: MSA의 교차검증용 근거 모음.
> 실제 도입 기업·엔지니어의 후기(모놀리스 회귀 사례 포함)를 우선 배치하고, 반복 확인된 단점을 테마별로 정리한다.
>
> **원칙**: 이 문서는 "안티 MSA" 자료가 아니라 **교차검증** 자료다. 단점만 골라 담는 것은 장점만 부각하는 것과 똑같은 오류이므로, MSA가 정당화되는 조건과 상대 주장이 옳은 지점(§4)도 함께 명시했다. 인용은 원문 그대로 옮기고, 검증에서 걸러진 주장·신뢰도 낮은 출처(§5)도 투명하게 표시한다.

작성 시점 근거: deep-research 다중검색(22개 출처, 96개 주장 추출, 25개 적대적 검증 → 22 확정 / 3 기각). 기각된 주장은 §5에 별도 표기.

---

## 1. 한눈에 보는 결론

- MSA의 이득(독립 배포, 팀 자율성, 부분 확장)은 **대규모 트래픽 + 다수의 팀 + 성숙한 DevOps**라는 전제가 충족될 때 성립한다. 전제가 빠지면 **모놀리스와 MSA의 단점만 결합된 "분산 모놀리스"**가 된다.
- 실제 기업들(Segment, Amazon Prime Video 팀 등)은 MSA를 도입했다가 **운영 부담·비용·스케일 한계** 때문에 모놀리스로 되돌렸고, 그 후기를 공개했다.
- 반복적으로 확인되는 단점은 ①운영 복잡도 ②분산 트랜잭션/데이터 정합성 ③네트워크 지연·장애 ④인프라·운영 비용 증가 ⑤디버깅·테스트 난이도 ⑥조직 역량 요구 ⑦배포·버전 파편화다.

---

## 2. 실제 사용자·기업 후기 (verbatim)

> 교과서적 "단점 목록"보다 실무자의 육성이 교차검증에 강하다. 아래는 실제 postmortem·기술 블로그에서 옮긴 원문이다.

### 2.1 Segment — 마이크로서비스에서 모놀리스로 회귀 (가장 상세한 postmortem)

**출처:** [Twilio/Segment 엔지니어링 블로그(1차)](https://www.twilio.com/en-us/blog/developers/best-practices/goodbye-microservices) · [한국어 번역본](https://tech.ssut.me/goodbye-microservice/) · [InfoQ 회고](https://www.infoq.com/news/2020/04/microservices-back-again/)

Segment(고객 데이터 인프라 기업)는 데이터 파이프라인을 **140개 이상의 마이크로서비스**로 운영하다가 감당 불가능한 운영 부담 때문에 모놀리스로 통합했다. 담당 엔지니어 **Alexandra Noonan**의 글 *"Goodbye Microservices"*([Twilio/Segment 엔지니어링 블로그](https://www.twilio.com/en-us/blog/developers/best-practices/goodbye-microservices), 2018).

- > "With our microservice architecture, our operational overhead increased **linearly with each added destination**."
  — 연동(destination)을 하나 추가할 때마다 운영 오버헤드가 **선형적으로** 증가.
- > "As our velocity plummeted, our **defect rate exploded**."
  — 개발 속도는 급락하고 결함 발생률은 폭증.
- > "**3 full-time engineers** spending most of their time just keeping the system alive."
  — 정규 엔지니어 3명이 대부분의 시간을 그저 시스템을 살아있게 유지하는 데만 소모.
- > "Making changes to improve our libraries, knowing we'd have to **test and deploy dozens of services**, was a risky proposition."
  — 공유 라이브러리 개선은 수십 개 서비스를 테스트·배포해야 해서 개선 자체가 위험한 일이 됨. (버전 파편화)
- > "Moving to a monolith allowed us to **rid our pipeline of operational issues while significantly increasing developer productivity**."
  — 모놀리스 전환으로 운영 문제가 사라지고 생산성이 크게 향상.

**단, 회귀의 트레이드오프도 당사자가 인정**했다(교차검증 균형):
- > "장애 격리는 어렵습니다. 모든 것이 모놀리식으로 돌아가기 때문에 만약에 한 목적지에서 어떤 버그가 발생했을 때 전체 서비스를 죽게끔 합니다." (한국어 번역본)
- 즉 "운영 단순성"을 얻는 대신 "장애 격리·모듈성"을 일부 포기했다. MSA의 장점 자체가 허구라는 뜻이 아니라, **그 팀·그 규모에서는 비용이 이득을 초과**했다는 것.

### 2.2 Amazon Prime Video — 서버리스/마이크로서비스 → 모놀리스, 비용 90% 절감

**출처:** [The Stack](https://www.thestack.technology/amazon-prime-video-microservices-monolith/) · [The New Stack](https://thenewstack.io/return-of-the-monolith-amazon-dumps-microservices-for-video-monitoring/) · [DHH 논평(편향 감안)](https://world.hey.com/dhh/even-amazon-can-t-make-sense-of-serverless-or-microservices-59625580)

> **정확한 프레이밍 주의**: 이것은 "아마존이 마이크로서비스를 포기했다"가 **아니다.** Prime Video 내부의 **한 팀(Video Quality Analysis)**이 **서버리스 프로토타입**(AWS Step Functions + Lambda 조합)을 단일 프로세스(ECS/EC2)로 재설계한 사례다. 이 구분을 흐리면 상대편이 하는 과장과 똑같은 오류가 된다.

Prime Video 선임 엔지니어 **Marcin Kolny**가 Prime Video 기술 블로그에 직접 공개([The Stack 정리](https://www.thestack.technology/amazon-prime-video-microservices-monolith/)):

- > "moving the video streaming to a monolithic architecture **reduced costs by 90%**." — 모놀리스 전환으로 비용 90% 절감.
- > "the way we used some components caused us to hit a **hard scaling limit at around 5% of the expected load**." — (그들이 컴포넌트를 구현한 방식에서) 예상 부하의 약 5% 수준에서 하드 스케일링 한계에 부딪힘. → *구현 방식에 종속된 한계이지, "마이크로서비스는 확장 안 된다"는 일반 명제가 아님.*
- 비용 폭증 원인: > "the need to **send data across multiple components**." — 여러 컴포넌트 간 데이터 전송 오버헤드.
- **본인의 균형 잡힌 단서(꼭 함께 인용할 것)**:
  > "Microservices and serverless components are tools that do work at high scale, but whether to use them over monolith **has to be made on a case-by-case basis**."
  — MSA/서버리스는 고규모에서 실제로 작동하는 도구이며, 모놀리스와의 선택은 사례별로 판단해야 한다.

### 2.3 카카오페이 결제팀 — 분산 트랜잭션의 실제 고통

**출처:** [카카오페이 기술블로그 — MSA 환경에서의 분산 트랜잭션](https://tech.kakaopay.com/post/msa-transaction/)

모놀리스의 단일 로컬 트랜잭션이 MSA에서는 별도의 난제가 된다는 실무 사례:

- > "MSA는 각 서비스마다 DB가 따로 있기 때문에 ... 각 DB에 걸쳐서 데이터 일관성을 보장할 수 있어야 합니다."
- 네트워크 타임아웃 문제: > "타임아웃과 같은 상황은 요청에 대한 성공 응답을 받지 못했지만, 트랜잭션의 결과가 성공했는지 실패했는지 명확하게 판단하기 어려운 경우입니다."
- **보상 트랜잭션의 무한 재귀**: > "보상 트랜잭션(결제 무효화)을 요청했지만 응답을 받지 못했을 때 **보상 트랜잭션의 보상 트랜잭션**을 요청해야 하는 상황." → try-catch 중첩으로는 안전하지 않아, Success/Failure/**Unknown** 세 상태를 명시하는 `ActResult` 자료구조를 **직접 구현**해야 했다(추가 엔지니어링 비용).

### 2.4 쿠팡 엔지니어링 — MSA 도구가 다시 모놀리스로 퇴화할 수 있음

**출처:** [Coupang Engineering (Medium)](https://medium.com/coupang-engineering/how-coupang-built-a-microservice-architecture-fd584fff7f2b)

쿠팡은 배포 병목(모놀리스 시절 "5줄 수정 배포에 2~3일 대기") 때문에 MSA로 갔지만, 자사 글에서 MSA 도구의 함정도 인정:

- > "이 라이브러리는 다양한 API 버전에 종속적이다보니, 버전이 많아지면 많아질수록 **모놀리식 시스템으로 변해버릴 수는 있습니다.**"
  — MSA용 클라이언트 헬퍼 라이브러리조차 버전이 늘면 모놀리스식 결합을 재도입할 수 있다.

### 2.5 PAYCO — MSA 게이트웨이 구성이 성능 병목을 유발

**출처:** [MSA 회사별 구축 사례 (velog)](https://velog.io/@rssungjae/후기마이크로서비스-아키텍처MSA-회사별-구축사례)

- > "마이크로서비스들을 웹플럭스 기반으로 만들었기 때문에(논블로킹) 블로킹 기반인 Zuul로 만들어진 게이트웨이로 인해 **병목현상이 발생**." → Spring Cloud Gateway로 교체하여 해결(모놀리스 회귀는 아님). MSA는 게이트웨이·통신 계층 구성 실수만으로도 실제 성능 저하를 낳는다는 사례.
- > "분산 환경에서의 문서 통합이 어려움" — Swagger 등 API 문서를 하나로 관리하기 어려운 운영 단점.

### 2.6 국내 실무자 후기 — "MSA는 복잡하다"

**출처:** [개인 개발자 MSA 프로젝트 회고 (velog)](https://velog.io/@sleekydevzero86/healthcare-msa-project-mistakes) · [Atlassian — 마이크로서비스 vs 모놀리스](https://www.atlassian.com/ko/microservices/microservices-architecture/microservices-vs-monolith)

- 개인 개발자 사례: > "서비스의 위치가 변경되거나 인스턴스가 늘어날 때마다 **수동으로 설정을 변경해야 함**" → 결국 Eureka 서비스 디스커버리 도입. > "MSA는 복잡하지만" (여전히 사용하면서도 복잡성 자체는 인정), "대부분의 서비스에 테스트 코드가 없어 리팩토링 시 버그 발생 위험이 높았음."
- [Atlassian](https://www.atlassian.com/ko/microservices/microservices-architecture/microservices-vs-monolith)(마이크로서비스 관리 제품 Compass를 파는 **벤더**)조차 자사 마이그레이션을 이렇게 회고:
  > "소수의 모놀리식 코드 베이스에서 ... 더 많은 분산 시스템 및 서비스로 전환했을 때 **의도하지 않은 복잡성**이 발생했습니다. 처음에는 과거와 동일한 속도와 확신을 가지고 새로운 기능을 추가하는 데 어려움을 겪었습니다."
  — 파는 쪽도 인정하는 단점이라는 점에서 신뢰도 높은 자백.

---

## 3. 반복 확인된 단점 (테마별)

여러 독립 출처에서 교차 확인된 항목. 회사·블로그·벤더 문서가 서로 다른데도 같은 결론에 수렴한다.

**이 절의 주요 출처:** [CIO Korea — 단점 5가지](https://www.ciokorea.com/news/39258) · [Atlassian 장단점](https://www.atlassian.com/ko/microservices/cloud-computing/advantages-of-microservices) · [삼성SDS 인사이트](https://www.samsungsds.com/kr/insights/msa.html) · [MSAP.ai 실무 가이드](https://www.msap.ai/docs/msa-expert-from-concepts-to-practice/) · [GetDX](https://getdx.com/blog/monolithic-vs-microservices/) · [Nortal](https://nortal.com/insights/microservices-vs-monoliths-lessons-learned-how-to-choose) · [imksh(안티 MSA 논지)](https://imksh.com/127)

### 3.1 운영 복잡도 증가
- 시스템을 다수 서비스로 쪼개므로 배포·인프라·잠재적 장애 지점이 늘고, 서비스 간 상호작용을 이해하기 어려워진다. 분산 환경에서 더 심화.
- 서비스 개수↑ → 네트워크·로깅·모니터링·배포 부담이 모두 증가.
- "서비스 디스커버리·모니터링·분산 추적·온콜 대응"에 필요한 투자를 **과소평가**하는 것이 가장 흔한 실패.

### 3.2 분산 트랜잭션 / 데이터 정합성
- 서비스마다 독립 DB → 여러 서비스에 걸친 데이터 일관성 보장이 별도 과제. 모놀리스의 단순 로컬 트랜잭션과 근본적으로 다름.
- 2PL, **Saga**, 이벤트 소싱, CQRS, Try-Later 등 난이도 높은 패턴을 **필수로** 도입해야 함(선택이 아님).
- 네트워크 타임아웃 → 성공/실패 판단 불가 상태, 보상 트랜잭션의 재귀 문제(§2.3).

### 3.3 네트워크 지연·장애
- 서비스 간 호출이 네트워크를 경유 → 지연(latency)·네트워크 장애·부하 증가. 홉(hop)이 늘수록 지연 처리 정책이 별도로 필요.
- 실무 후기: MSA 앱 배포 후 상당한 비용의 네트워크 인프라 업그레이드가 필요했다는 증언.

### 3.4 인프라·운영 비용 증가
- 여러 인스턴스 운영 → 대부분의 경우 단일 모놀리스보다 더 많은 컴퓨팅 자원 소비.
- 새 서비스마다 테스트 도구·배포 플레이북·호스팅 인프라·모니터링 도구의 **자체 비용** → 인프라 비용이 기하급수적으로 증가 가능.
- Prime Video 사례처럼 컴포넌트 간 데이터 전송 비용이 대규모에서 감당 불가로 치달을 수 있음.
- 반증 포인트: "MSA = 비용 효율"이라는 통념과 달리, 비용 증가로 귀결되어 경영진 신뢰 상실·프로젝트 중단으로 이어질 수 있다는 국내 후기.

### 3.5 디버깅·테스트 난이도
- 하나의 비즈니스 프로세스가 여러 시스템에 걸쳐 실행되고, 서비스마다 별도 로그 집합 → 문제 추적 시 여러 서비스·로그·도구 사이를 오가야 함.
- 통합 테스트가 여러 서비스에 걸쳐 복잡한 시나리오를 오케스트레이션해야 해서 어려움. Segment는 서비스 140개+로 테스트가 최대 1시간까지 소요.

### 3.6 조직 역량 요구 / "분산 모놀리스" 함정
- MSA는 모놀리스보다 훨씬 높은 개발·운영 역량을 요구한다. 순수 아키텍처 문제가 아니라 **팀 자율성·조율을 요구하는 문화적 전환**.
- 조직 준비 없이 조기 도입 시 → 서비스가 강결합인데 개별 배포되는 **"분산 모놀리스"** = 모놀리스와 MSA 양쪽의 최악 결합.
- 리더·실무진 경험 부족 또는 외부 SI 의존 시 성공률 매우 낮고, 계약 종료 후 유지보수 불가능한 코드만 남을 위험.
- 피해야 하는 조건(여러 출처 공통): 개발자 10~15명 미만 팀 / DevOps 파이프라인 미성숙 / 관측성 역량 부족 / 서비스 경계 불명확 / MVP·초기 제품.

### 3.7 배포·버전 파편화
- 한 서비스 변경이 API로 연결된 다른 서비스에 연쇄 영향 → 버저닝·호환성 문제(특히 업그레이드 시).
- 공유 라이브러리 하나 바꾸는 데 수십~140개 서비스 재배포·테스트 필요(§2.1). 의존성 버전이 서비스마다 제각각으로 파편화.

---

## 4. 균형: MSA가 정당한 경우 & 상대 주장이 옳은 지점

교차검증의 신뢰도를 위해, MSA 옹호가 맞는 부분을 명시한다.

- **정당화되는 조건**: 대규모 트래픽 + 여러 독립 팀 + 성숙한 DevOps/관측성 + 명확한 도메인 경계. 이 조합에서는 독립 배포·부분 확장·팀 자율성의 이득이 운영 비용을 초과한다. (Kolny: "tools that do work at high scale")
- **모놀리스 회귀 사례의 한계**: Segment·Prime Video 모두 "우리 규모·우리 구현에서" 비용이 이득을 넘었다는 것이지, MSA가 원리적으로 틀렸다는 증명이 아니다. 회귀에도 장애 격리 약화 등 대가가 따른다.
- **권장 진화 경로(여러 출처 공통)**: 소규모/MVP → **모놀리스**, 복잡성 신호가 보이면 → **모듈러 모놀리스**, 여러 팀 규모가 되면 → **마이크로서비스**. Martin Fowler의 *MonolithFirst*와 결이 같다.
- 결론: 상대가 틀린 건 "MSA는 좋다"가 아니라, **전제 조건과 비용을 생략한 채 만능처럼 제시**하는 부분이다.

---

## 5. 출처 신뢰도 주의 (검증 과정에서 걸러낸 것)

투명성을 위해, 유혹적이지만 사용하면 안 되는 근거를 명시한다.

**적대적 검증에서 기각된 주장(사용 금지):**
1. ❌ "Segment은 **250개 마이크로서비스 / 16,000개 컨테이너**를 운영했다" — 2차 출처(CIO Korea)의 수치로, 검증에서 기각. **1차 출처(Noonan/Twilio)는 "140개+ 서비스"**라고 명시하므로 그 수치를 쓸 것. 컨테이너 수는 인용하지 말 것.
2. ⚠️ Prime Video "5% 부하에서 스케일 한계" — **인용문 자체는 유효**하나, "마이크로서비스는 스케일에서 실패한다"는 **일반화 프레이밍은 기각**됨. AWS 블로그 원문대로 "그 팀이 컴포넌트를 구현한 방식"에서 발생한 한계로 한정해 인용할 것.
3. ❌ "적절한 장애 격리에는 **10,000개 이상의 마이크로서비스**가 필요했을 것" — 만장일치 기각(0 keep / 3 refute). 문서에서 제외.

**신뢰도 낮아 사례로 쓰면 안 되는 출처:**
- 국내 블로그의 "처참히 실패한 MSA 전환" 글(2024-10) — 저자가 "이 글에서 등장하는 배경은 **픽션입니다**"라고 명시. **실제 postmortem이 아니라 예시 시나리오**이므로 실사례로 인용 금지(개념 설명용으로만).
- 친(親)MSA 사례집(빙글·넷플릭스·PAYCO를 다루나 대부분 모놀리스 시절 단점을 MSA 전환 근거로 제시) 및 쿠팡 글의 배포 병목 서술 — 이는 **MSA 옹호 논거**이지 단점 근거가 아니다. §2에서는 이들 출처 중 MSA 도입 후의 실제 단점 서술만 골라 인용했다.

**검증 커버리지 한계:** 추출된 96개 주장 중 25개만 적대적 검증을 거쳤다(예산 제약). §2·§3의 정성적 단점(복잡도·분산 트랜잭션·운영 부담·디버깅)은 다수 출처에서 교차 확인되어 견고하나, **개별 수치(90%·5%·140개·"엔지니어 3명")는 1차 출처 원문과 대조**해 인용할 것.

---

## 6. 교차검증 체크리스트 (장점 주장 만났을 때 되물을 질문)

상대가 MSA 장점을 말할 때 아래를 대입하면 균형이 잡힌다.

1. "독립 배포/확장" → **팀이 몇 개인가? 서비스 경계가 도메인과 일치하나?** 아니면 분산 모놀리스가 된다.
2. "장애 격리" → 분산 트랜잭션·데이터 정합성 비용(Saga/보상 트랜잭션)은 누가 감당하나?
3. "확장성" → Prime Video처럼 컴포넌트 간 데이터 전송 비용이 대규모에서 폭증하지 않는 구조인가?
4. "빠른 개발" → 공유 라이브러리 변경 시 몇 개 서비스를 재배포·테스트해야 하나?(Segment: 140개+, 최대 1시간)
5. "비용 절감" → 서비스별 인프라·모니터링·온콜 비용을 합산했나? 실측 비교치가 있나?
6. "조직 확장성" → DevOps·관측성·분산 추적에 대한 선행 투자가 준비됐나? 팀이 15명 미만이면 재고.
7. 대안: **모듈러 모놀리스**로 같은 이득 일부를 더 싸게 얻을 수 있지 않나?

---

## 7. MSA 도입 여부 결정 체크리스트 (검증된 프레임워크)

"도입할지 말지"를 판단하는 **공인된 결정·준비도 체크리스트가 실제로 존재한다.** 개인 의견이 아니라 업계 표준으로 인용되는 3개를 정리한다. §6이 "장점 주장에 되물을 질문"이라면, 이 절은 "조직이 실제로 준비됐는지" 판정하는 도구다.

### 7.1 Martin Fowler — 「Microservice Prerequisites」 (2014)
> "You must be this tall to use microservices." — 프로덕션에 MSA를 올리기 **전에 반드시 갖춰야 할 4대 역량**. 하나라도 없으면 도입을 미루고 먼저 그 역량을 만들라는 것.

| # | 필수 역량 | 판정 기준 |
|---|----------|----------|
| 1 | **빠른 프로비저닝(Rapid provisioning)** | 새 서버를 며칠이 아니라 **시간 단위**로 띄울 수 있는가 |
| 2 | **기본 모니터링(Basic monitoring)** | 장애를 빠르게 감지·추적하고 이전 버전으로 즉시 롤백할 수 있는가 |
| 3 | **빠른 배포(Rapid application deployment)** | 다수 서비스를 자동 파이프라인으로 **수 시간 내** 테스트·프로덕션 배포할 수 있는가 |
| 4 | **DevOps 문화(DevOps culture)** | 개발·운영이 긴밀히 협업하는 조직 구조·문화가 있는가 |

관련 개념 **Microservice Premium**: MSA는 복잡성 '할증료'를 항상 부과하므로, 시스템 복잡도가 그 할증을 넘어설 만큼 높을 때만 이득이다. → §4의 진화 경로(모놀리스 우선)와 동일한 논지.

### 7.2 Sam Newman — 「Building/Monolith to Microservices」의 결정 원칙
- **기본값은 모놀리스.** > "my default is absolutely to look at a really simple deployment topology — a single process monolith." 정말 좋은 이유가 없으면 모놀리스로 간다.
- **MSA를 택할 좋은 이유(3):** ① 독립 배포 가능성(나머지를 안 건드리고 기능 배포) ② 데이터·처리 격리(규제 산업의 컴플라이언스 등) ③ 팀 자율성(분산된 팀에 책임 위임).
- **피해야 하는 경우:** 목적이 불명확한데 유행만 좇을 때 / **신규 제품·스타트업**(안정적 서비스 경계를 아직 모름) / 소프트웨어를 **고객이 직접 설치·운영**하는 형태(운영 복잡성을 고객에게 전가 불가).
- **전환 방식:** 6개월짜리 빅뱅 재작성 금지. 모놀리스에서 **한 모듈만 먼저 서비스로 분리**(Strangler Fig)하며 점진 이행.

### 7.3 Microsoft — 「Microservices Assessment and Readiness」 (Azure Architecture Center, 2026-06 갱신)
도입 **전** 조직·인프라·DevOps·개발 모델의 성숙도를 점검하는 공식 평가. 각 축마다 "현재 상태 → 목표와의 격차 → 담당자·기한"을 기록하고, 발견 사항을 **차단요인(blocker) vs 개선(improvement)** 으로 분류해 우선순위화하라고 한다. 핵심 평가 축:

| 평가 축 | 준비됐는지 묻는 핵심 질문 |
|--------|----------------------|
| 비즈니스 우선순위 | 아키텍처가 혁신/신뢰성/효율 중 무엇을 위한 것인가, SLO는 정의됐나 |
| 팀 구성 | 도메인(DDD) 기반의 작고 교차기능적인 팀인가 |
| DevOps 준비도 | CI/CD·지속적 모니터링을 실제로 운용하나 |
| 인프라 준비도 | 컨테이너·오토스케일·DR·자동 프로비저닝이 되나 |
| 서비스 통신 | API-우선, 재시도·서킷브레이커 등 복원 패턴이 있나 |
| 트랜잭션 처리 | 분산 트랜잭션을 Saga·이벤트소싱·CQRS·보상으로 다루나 |
| 모니터링 | 분산 추적(Trace ID)·OpenTelemetry로 요청을 end-to-end 재구성하나 |
| 보안 | Zero Trust·서비스별 토큰 검증·mTLS·시크릿 관리가 되나 |
| 릴리스/배포 | 시맨틱 버저닝·API 버저닝·IaC·불변 인프라를 쓰나 |

> 참고: 이 평가는 도입 전뿐 아니라 **분해 중·운영 중**(연 1회 또는 중대 사고 후)에도 반복 실행하도록 설계돼 있다.

### 7.4 종합 Go / No-Go 판정 (위 3개를 하나로)
- **No-Go(도입 보류)**: Fowler 4대 역량 중 결여가 있음 / 팀 15명 미만 또는 단일 팀 / 도메인 경계 불명확·신규 제품 / "왜 MSA인가"에 대한 구체적 목적 없음 / 자체 설치형 소프트웨어. → **모놀리스 또는 모듈러 모놀리스 유지**.
- **Go(도입 검토)**: Fowler 4대 역량 확보 + 여러 독립 팀 + 명확한 도메인 경계 + 독립 배포/데이터 격리/팀 자율성 중 **구체적이고 측정 가능한 목적** 존재. → 빅뱅이 아니라 **Strangler Fig로 한 모듈부터** 점진 분리, MS 평가 축으로 준비도 재점검.

---

## 8. 출처 목록

**도입 결정·준비도 프레임워크(§7):**
- Martin Fowler, *Microservice Prerequisites* ("You must be this tall") — https://martinfowler.com/bliki/MicroservicePrerequisites.html
- Martin Fowler, *MonolithFirst* / *Microservice Premium* — https://martinfowler.com/bliki/MonolithFirst.html
- Sam Newman & Martin Fowler, *When To Use Microservices (and When Not To!)* (GOTO 2020) 정리 — https://blog.dreamfactory.com/when-to-use-microservices-sam-newman-and-martin-fowler-share-their-knowledge · https://www.oreilly.com/content/should-i-use-microservices/
- Microsoft Learn, *Microservices Assessment and Readiness* (Azure Architecture Center) — https://learn.microsoft.com/azure/architecture/guide/technology-choices/microservices-assessment

**모놀리스 회귀·실패 postmortem (1차/실무):**
- Alexandra Noonan, *"Goodbye Microservices: From 100s of problem children to 1 superstar"*, Twilio/Segment Blog (2018) — https://www.twilio.com/en-us/blog/developers/best-practices/goodbye-microservices (한국어 번역: https://tech.ssut.me/goodbye-microservice/)
- InfoQ, *"Segment: Microservices to Monolith and Back Again"* (2020) — https://www.infoq.com/news/2020/04/microservices-back-again/
- Marcin Kolny (Amazon Prime Video), via The Stack (2023) — https://www.thestack.technology/amazon-prime-video-microservices-monolith/
- The New Stack, *"Return of the Monolith: Amazon Dumps Microservices for Video Monitoring"* — https://thenewstack.io/return-of-the-monolith-amazon-dumps-microservices-for-video-monitoring/
- DHH, *"Even Amazon can't make sense of serverless or microservices"* (논평, 편향 감안) — https://world.hey.com/dhh/even-amazon-can-t-make-sense-of-serverless-or-microservices-59625580

**기업 실무 기술 블로그:**
- 카카오페이 기술블로그, MSA 분산 트랜잭션 — https://tech.kakaopay.com/post/msa-transaction/
- 쿠팡 엔지니어링(Medium) — https://medium.com/coupang-engineering/how-coupang-built-a-microservice-architecture-fd584fff7f2b
- PAYCO MSA 구축 사례(velog) — https://velog.io/@rssungjae/후기마이크로서비스-아키텍처MSA-회사별-구축사례

**벤더·개요·트레이드오프 문서:**
- Atlassian, 마이크로서비스 장단점 / vs 모놀리스(자사 마이그레이션 회고 포함) — https://www.atlassian.com/ko/microservices/cloud-computing/advantages-of-microservices · https://www.atlassian.com/ko/microservices/microservices-architecture/microservices-vs-monolith
- CIO Korea, *"만능 아니다 — 마이크로서비스의 단점 5가지"* — https://www.ciokorea.com/news/39258 · https://www.cio.com/article/3504222/
- 삼성SDS 인사이트, MSA — https://www.samsungsds.com/kr/insights/msa.html
- MSAP.ai, MSA 실무 가이드(장단점) — https://www.msap.ai/docs/msa-expert-from-concepts-to-practice/
- GetDX, *Monolithic vs Microservices* — https://getdx.com/blog/monolithic-vs-microservices/
- Nortal, *Microservices vs Monoliths: Lessons Learned* — https://nortal.com/insights/microservices-vs-monoliths-lessons-learned-how-to-choose
- Martin Fowler, *MonolithFirst* — https://martinfowler.com/bliki/MonolithFirst.html
- 국내 블로그(안티 MSA 논지, 2020) — https://imksh.com/127

> ⚠️ §5의 신뢰도 주의를 반드시 함께 볼 것: 위 출처 중 일부는 친MSA 논거이거나 픽션 시나리오이며, 일부 수치는 검증에서 기각되었다.
