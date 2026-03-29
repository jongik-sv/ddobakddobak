#![allow(dead_code)]
use rubato::{FftFixedIn, Resampler};

/// 입력 오디오를 16kHz mono Int16로 변환한다.
/// - channels: 원본 채널 수
/// - source_rate: 원본 샘플레이트 (e.g. 48000)
/// - samples: interleaved Float32 샘플 (range -1.0..1.0)
pub fn resample_to_16k_mono_i16(
    samples: &[f32],
    source_rate: u32,
    channels: u16,
) -> Vec<i16> {
    let ch = channels as usize;

    // 1) stereo/multi-channel → mono (채널 평균)
    let mono: Vec<f32> = if ch == 1 {
        samples.to_vec()
    } else {
        samples
            .chunks_exact(ch)
            .map(|frame| frame.iter().sum::<f32>() / ch as f32)
            .collect()
    };

    // 2) 리샘플링 (source_rate → 16000)
    let target_rate = 16000_u32;
    let resampled = if source_rate == target_rate {
        mono
    } else {
        resample_sinc(&mono, source_rate, target_rate)
    };

    // 3) Float32 → Int16
    resampled
        .iter()
        .map(|&s| {
            let clamped = s.clamp(-1.0, 1.0);
            (clamped * 32767.0) as i16
        })
        .collect()
}

fn resample_sinc(input: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    let chunk_size = 1024;
    let mut resampler = FftFixedIn::<f32>::new(
        from_rate as usize,
        to_rate as usize,
        chunk_size,
        2,  // sub_chunks
        1,  // channels (already mono)
    )
    .expect("resampler 생성 실패");

    let mut output = Vec::with_capacity(input.len() * to_rate as usize / from_rate as usize + 1024);

    // 청크 단위로 리샘플링
    let mut pos = 0;
    while pos + chunk_size <= input.len() {
        let chunk = &input[pos..pos + chunk_size];
        let result = resampler
            .process(&[chunk], None)
            .expect("리샘플링 실패");
        output.extend_from_slice(&result[0]);
        pos += chunk_size;
    }

    // 남은 샘플 처리 (zero-pad)
    if pos < input.len() {
        let remaining = input.len() - pos;
        let mut padded = vec![0.0_f32; chunk_size];
        padded[..remaining].copy_from_slice(&input[pos..]);
        let result = resampler
            .process(&[&padded], None)
            .expect("리샘플링 실패");
        // 패딩 비율만큼만 출력 사용
        let valid_out = remaining * to_rate as usize / from_rate as usize;
        let take = valid_out.min(result[0].len());
        output.extend_from_slice(&result[0][..take]);
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mono_passthrough_at_16k() {
        let samples: Vec<f32> = (0..1600).map(|i| (i as f32 / 1600.0) * 2.0 - 1.0).collect();
        let result = resample_to_16k_mono_i16(&samples, 16000, 1);
        assert_eq!(result.len(), 1600);
    }

    #[test]
    fn test_stereo_to_mono() {
        // L=1.0, R=-1.0 → mono=0.0
        let samples = vec![1.0_f32, -1.0, 1.0, -1.0];
        let result = resample_to_16k_mono_i16(&samples, 16000, 2);
        assert_eq!(result.len(), 2);
        assert!(result.iter().all(|&v| v.abs() < 10)); // 0에 가까움
    }

    #[test]
    fn test_48k_to_16k_ratio() {
        let samples: Vec<f32> = vec![0.5; 48000]; // 1초 @ 48kHz
        let result = resample_to_16k_mono_i16(&samples, 48000, 1);
        // 16000 ± 허용 오차
        assert!(result.len() >= 15000 && result.len() <= 17000);
    }

    #[test]
    fn test_clamp() {
        let samples = vec![2.0_f32, -2.0];
        let result = resample_to_16k_mono_i16(&samples, 16000, 1);
        assert_eq!(result[0], 32767);
        assert_eq!(result[1], -32767);
    }
}
