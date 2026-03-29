use screencapturekit::cm::CMSampleBuffer;
use screencapturekit::prelude::*;
use screencapturekit::shareable_content::SCShareableContent;
use screencapturekit::stream::configuration::audio::AudioSampleRate;
use screencapturekit::stream::output_type::SCStreamOutputType;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// macOS 시스템 오디오 캡처 결과를 전달하는 콜백 타입
pub type AudioChunkCallback = Box<dyn Fn(Vec<i16>) + Send + Sync>;

/// ~300ms 분량 배치 사이즈 (16kHz 기준 4800 samples)
const BATCH_SAMPLES_16K: usize = 4800;

/// macOS ScreenCaptureKit 기반 시스템 오디오 캡처
pub struct SystemAudioCapture {
    stream: Option<SCStream>,
    running: Arc<AtomicBool>,
}

struct AudioState {
    callback: AudioChunkCallback,
    buffer: Mutex<Vec<f32>>,
    running: Arc<AtomicBool>,
}

unsafe impl Send for AudioState {}
unsafe impl Sync for AudioState {}

impl SystemAudioCapture {
    /// 시스템 오디오 캡처를 시작한다.
    /// ScreenCaptureKit에서 직접 16kHz mono로 캡처하여 리샘플링 불필요.
    /// callback: 16kHz mono Int16 PCM 청크가 준비될 때마다 호출
    pub fn start(callback: AudioChunkCallback) -> Result<Self, String> {
        let content = SCShareableContent::get()
            .map_err(|e| format!("SCShareableContent 가져오기 실패: {:?}", e))?;
        let displays = content.displays();

        if displays.is_empty() {
            return Err("사용 가능한 디스플레이가 없습니다".to_string());
        }

        let display = &displays[0];

        // 오디오 전용 캡처 설정: 16kHz mono로 직접 캡처 (리샘플링 불필요)
        let config = SCStreamConfiguration::new()
            .with_captures_audio(true)
            .with_excludes_current_process_audio(true)
            .with_sample_rate(AudioSampleRate::Rate16000)
            .with_channel_count(1)  // mono
            .with_width(2)   // 비디오 최소화 (0은 불가)
            .with_height(2);

        let filter = SCContentFilter::create()
            .with_display(display)
            .with_excluding_windows(&[])
            .build();

        let running = Arc::new(AtomicBool::new(true));

        let state = Arc::new(AudioState {
            callback,
            buffer: Mutex::new(Vec::with_capacity(BATCH_SAMPLES_16K * 2)),
            running: running.clone(),
        });

        // 클로저로 오디오 핸들러 등록
        let handler_state = state.clone();
        let audio_handler = move |sample_buffer: CMSampleBuffer, of_type: SCStreamOutputType| {
            if of_type != SCStreamOutputType::Audio {
                return;
            }
            if !handler_state.running.load(Ordering::Relaxed) {
                return;
            }

            if let Some(audio_buffer_list) = sample_buffer.audio_buffer_list() {
                for audio_buf in &audio_buffer_list {
                    let raw_bytes = audio_buf.data();
                    if raw_bytes.is_empty() {
                        continue;
                    }

                    // ScreenCaptureKit는 Float32 PCM으로 출력
                    let floats: &[f32] = unsafe {
                        std::slice::from_raw_parts(
                            raw_bytes.as_ptr().cast::<f32>(),
                            raw_bytes.len() / 4,
                        )
                    };

                    let mut buf = handler_state.buffer.lock().unwrap();
                    buf.extend_from_slice(floats);

                    // 배치 사이즈만큼 모이면 Int16 변환 후 콜백
                    while buf.len() >= BATCH_SAMPLES_16K {
                        let chunk: Vec<f32> = buf.drain(..BATCH_SAMPLES_16K).collect();
                        let pcm_i16: Vec<i16> = chunk
                            .iter()
                            .map(|&s| (s.clamp(-1.0, 1.0) * 32767.0) as i16)
                            .collect();
                        (handler_state.callback)(pcm_i16);
                    }
                }
            }
        };

        let mut stream = SCStream::new(&filter, &config);
        stream.add_output_handler(audio_handler, SCStreamOutputType::Audio);
        stream
            .start_capture()
            .map_err(|e| format!("캡처 시작 실패: {:?}", e))?;

        log::info!(
            "[SystemAudioCapture] macOS 시스템 오디오 캡처 시작 (16kHz, mono)"
        );

        Ok(Self {
            stream: Some(stream),
            running,
        })
    }

    /// 캡처를 중지한다.
    pub fn stop(&mut self) {
        self.running.store(false, Ordering::Relaxed);
        if let Some(ref stream) = self.stream.take() {
            stream.stop_capture().ok();
            log::info!("[SystemAudioCapture] macOS 시스템 오디오 캡처 중지");
        }
    }
}

impl Drop for SystemAudioCapture {
    fn drop(&mut self) {
        self.stop();
    }
}
