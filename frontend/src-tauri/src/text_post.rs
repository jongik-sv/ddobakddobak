//! 호스트에서 테스트 가능한 순수 후처리 헬퍼.
//!
//! `cut_eos`는 Cohere Transcribe 결과의 EOS 누수(`<|endoftext|>` 등 `<|...|>`
//! 특수 토큰)를 제거한다. Android FFI 경로(`cohere_ffi::CohereRecognizer::
//! transcribe`)가 이 함수를 호출하지만, 함수 자체는 순수 Rust이므로 cfg 게이트
//! 없이 모든 타깃에서 컴파일되고 호스트에서 `cargo test`로 검증된다.

/// 첫 번째 `"<|"` 등장 위치에서 잘라내고 양끝 공백을 제거한다.
/// EOS 특수 토큰(`<|endoftext|>`, `<|im_start|>` 등)이 본문으로 새어 나오는 것을
/// 방지하는 마지막 방어선이다.
pub fn cut_eos(s: &str) -> String {
    let cut = match s.find("<|") {
        Some(i) => &s[..i],
        None => s,
    };
    cut.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::cut_eos;

    #[test]
    fn cuts_at_first_eos_marker() {
        assert_eq!(cut_eos("안녕하세요<|endoftext|>"), "안녕하세요");
    }

    #[test]
    fn passes_through_when_no_marker() {
        assert_eq!(cut_eos("가나다"), "가나다");
    }

    #[test]
    fn empty_when_marker_leads() {
        assert_eq!(cut_eos("<|x|>"), "");
    }

    #[test]
    fn trims_whitespace() {
        assert_eq!(cut_eos("  안녕하세요  <|endoftext|>"), "안녕하세요");
        assert_eq!(cut_eos("  가나다  "), "가나다");
    }
}
