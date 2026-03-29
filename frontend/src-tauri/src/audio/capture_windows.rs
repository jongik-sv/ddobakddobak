use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use super::resample::resample_to_16k_mono_i16;

/// Windows 시스템 오디오 캡처 결과를 전달하는 콜백 타입
pub type AudioChunkCallback = Box<dyn Fn(Vec<i16>) + Send + Sync>;

/// ~300ms 분량 배치 사이즈 (16kHz 기준 4800 samples)
const BATCH_SAMPLES_16K: usize = 4800;

/// Windows WASAPI loopback 기반 시스템 오디오 캡처
pub struct SystemAudioCapture {
    stream: Option<cpal::Stream>,
    running: Arc<AtomicBool>,
}

impl SystemAudioCapture {
    /// 시스템 오디오 캡처를 시작한다.
    /// callback: 16kHz mono Int16 PCM 청크가 준비될 때마다 호출
    pub fn start(callback: AudioChunkCallback) -> Result<Self, String> {
        let host = cpal::default_host();

        // 기본 출력 디바이스를 loopback으로 캡처
        let device = host
            .default_output_device()
            .ok_or("기본 출력 디바이스를 찾을 수 없습니다")?;

        let default_config = device
            .default_output_config()
            .map_err(|e| format!("출력 설정 조회 실패: {}", e))?;

        let source_rate = default_config.sample_rate().0;
        let source_channels = default_config.channels();
        let sample_format = default_config.sample_format();

        let config: StreamConfig = default_config.into();
        let running = Arc::new(AtomicBool::new(true));
        let running_clone = running.clone();

        let buffer: Arc<Mutex<Vec<f32>>> =
            Arc::new(Mutex::new(Vec::with_capacity(source_rate as usize)));
        let buffer_clone = buffer.clone();
        let callback = Arc::new(callback);
        let callback_clone = callback.clone();

        let batch_source_samples =
            BATCH_SAMPLES_16K * source_rate as usize / 16000 * source_channels as usize;

        let err_callback = move |err: cpal::StreamError| {
            log::error!("[SystemAudioCapture] WASAPI stream error: {}", err);
        };

        // WASAPI loopback: 출력 디바이스에서 build_input_stream 호출
        let stream = match sample_format {
            SampleFormat::F32 => device.build_input_stream(
                &config,
                move |data: &[f32], _info: &cpal::InputCallbackInfo| {
                    if !running_clone.load(Ordering::Relaxed) {
                        return;
                    }
                    let mut buf = buffer_clone.lock().unwrap();
                    buf.extend_from_slice(data);

                    while buf.len() >= batch_source_samples {
                        let chunk: Vec<f32> = buf.drain(..batch_source_samples).collect();
                        let pcm_i16 =
                            resample_to_16k_mono_i16(&chunk, source_rate, source_channels);
                        if !pcm_i16.is_empty() {
                            (callback_clone)(pcm_i16);
                        }
                    }
                },
                err_callback,
                None,
            ),
            SampleFormat::I16 => device.build_input_stream(
                &config,
                move |data: &[i16], _info: &cpal::InputCallbackInfo| {
                    if !running_clone.load(Ordering::Relaxed) {
                        return;
                    }
                    // i16 → f32 변환
                    let floats: Vec<f32> = data.iter().map(|&s| s as f32 / 32768.0).collect();
                    let mut buf = buffer_clone.lock().unwrap();
                    buf.extend_from_slice(&floats);

                    while buf.len() >= batch_source_samples {
                        let chunk: Vec<f32> = buf.drain(..batch_source_samples).collect();
                        let pcm_i16 =
                            resample_to_16k_mono_i16(&chunk, source_rate, source_channels);
                        if !pcm_i16.is_empty() {
                            (callback_clone)(pcm_i16);
                        }
                    }
                },
                err_callback,
                None,
            ),
            _ => return Err(format!("지원하지 않는 샘플 포맷: {:?}", sample_format)),
        }
        .map_err(|e| format!("loopback 스트림 생성 실패: {}", e))?;

        stream
            .play()
            .map_err(|e| format!("스트림 시작 실패: {}", e))?;

        log::info!(
            "[SystemAudioCapture] Windows WASAPI loopback 캡처 시작 ({}Hz, {}ch, {:?})",
            source_rate,
            source_channels,
            sample_format
        );

        Ok(Self {
            stream: Some(stream),
            running,
        })
    }

    /// 캡처를 중지한다.
    pub fn stop(&mut self) {
        self.running.store(false, Ordering::Relaxed);
        if let Some(stream) = self.stream.take() {
            drop(stream);
            log::info!("[SystemAudioCapture] Windows WASAPI loopback 캡처 중지");
        }
    }
}

impl Drop for SystemAudioCapture {
    fn drop(&mut self) {
        self.stop();
    }
}
