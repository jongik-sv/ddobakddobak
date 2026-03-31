use hound::{WavSpec, WavWriter};
use std::fs::File;
use std::io::BufWriter;
use std::sync::Mutex;

const SAMPLE_RATE: u32 = 16000;

/// PCM 오디오를 WAV 파일로 기록한다.
/// audio-processor.js에서 마이크 + 시스템 오디오를 믹싱한 PCM을 받아 기록.
pub struct AudioRecorder {
    writer: Mutex<Option<WavWriter<BufWriter<File>>>>,
    path: String,
    paused: Mutex<bool>,
}

impl AudioRecorder {
    pub fn start(path: &str) -> Result<Self, String> {
        let spec = WavSpec {
            channels: 1,
            sample_rate: SAMPLE_RATE,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };

        let writer = WavWriter::create(path, spec)
            .map_err(|e| format!("WAV 파일 생성 실패: {}", e))?;

        log::info!("[AudioRecorder] 녹음 시작: {}", path);

        Ok(Self {
            writer: Mutex::new(Some(writer)),
            path: path.to_string(),
            paused: Mutex::new(false),
        })
    }

    pub fn pause(&self) {
        *self.paused.lock().unwrap() = true;
    }

    pub fn resume(&self) {
        *self.paused.lock().unwrap() = false;
    }

    /// 믹싱된 PCM을 즉시 WAV에 기록한다.
    pub fn feed_mic(&self, samples: &[i16]) {
        if *self.paused.lock().unwrap() {
            return;
        }
        let mut writer_lock = self.writer.lock().unwrap();
        if let Some(writer) = writer_lock.as_mut() {
            for &s in samples {
                writer.write_sample(s).ok();
            }
        }
    }

    /// 하위 호환: 시스템 오디오는 JS에서 믹싱되므로 no-op.
    pub fn feed_system(&self, _samples: &[i16]) {}

    pub fn stop(&self) -> Result<String, String> {
        let mut writer_lock = self.writer.lock().unwrap();
        if let Some(writer) = writer_lock.take() {
            writer
                .finalize()
                .map_err(|e| format!("WAV finalize 실패: {}", e))?;
        }

        log::info!("[AudioRecorder] 녹음 종료: {}", self.path);
        Ok(self.path.clone())
    }
}
