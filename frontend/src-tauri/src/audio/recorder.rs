use std::fs::File;
use std::io::{BufWriter, Seek, SeekFrom, Write};
use std::sync::Mutex;

const SAMPLE_RATE: u32 = 16000;
const CHANNELS: u16 = 1;
const BITS: u16 = 16;

/// 헤더의 size 필드를 디스크에 다시 써서 갱신하는 주기(데이터 바이트 기준).
/// 약 5초 분량(16k * 2byte * 5s). 강제종료 시 헤더가 최대 이 정도만 stale.
const HEADER_FLUSH_INTERVAL: u64 = SAMPLE_RATE as u64 * 2 * 5;

/// 표준 44바이트 PCM WAV 헤더를 기록한다. data_bytes로 RIFF/data size를 채운다.
fn write_wav_header(w: &mut impl Write, data_bytes: u32) -> std::io::Result<()> {
    let byte_rate = SAMPLE_RATE * CHANNELS as u32 * BITS as u32 / 8;
    let block_align = CHANNELS * BITS / 8;
    w.write_all(b"RIFF")?;
    w.write_all(&(36 + data_bytes).to_le_bytes())?;
    w.write_all(b"WAVE")?;
    w.write_all(b"fmt ")?;
    w.write_all(&16u32.to_le_bytes())?;
    w.write_all(&1u16.to_le_bytes())?; // PCM
    w.write_all(&CHANNELS.to_le_bytes())?;
    w.write_all(&SAMPLE_RATE.to_le_bytes())?;
    w.write_all(&byte_rate.to_le_bytes())?;
    w.write_all(&block_align.to_le_bytes())?;
    w.write_all(&BITS.to_le_bytes())?;
    w.write_all(b"data")?;
    w.write_all(&data_bytes.to_le_bytes())?;
    Ok(())
}

/// 기존 WAV 파일의 RIFF/data size 필드를 실제 파일 크기로부터 다시 계산해 덮어쓴다.
/// 강제종료로 헤더 size가 0/누락된 파일을 복구할 때 사용(멱등).
pub fn finalize_wav_header(path: &str) -> Result<(), String> {
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .open(path)
        .map_err(|e| format!("WAV 열기 실패: {}", e))?;
    let size = f.metadata().map_err(|e| e.to_string())?.len();
    if size < 44 {
        return Err("WAV 헤더 미만 크기".to_string());
    }
    let data_bytes = (size - 44) as u32;
    f.seek(SeekFrom::Start(4)).map_err(|e| e.to_string())?;
    f.write_all(&(36 + data_bytes).to_le_bytes())
        .map_err(|e| e.to_string())?;
    f.seek(SeekFrom::Start(40)).map_err(|e| e.to_string())?;
    f.write_all(&data_bytes.to_le_bytes())
        .map_err(|e| e.to_string())?;
    f.flush().map_err(|e| e.to_string())?;
    Ok(())
}

struct Inner {
    file: BufWriter<File>,
    data_bytes: u64,
    since_flush: u64,
}

impl Inner {
    /// 헤더 size 필드를 현재 data_bytes로 갱신하고 디스크에 flush한다.
    /// 끝까지 seek해 이후 append가 이어지도록 복원한다.
    fn flush_header(&mut self) -> std::io::Result<()> {
        let data = self.data_bytes as u32;
        self.file.seek(SeekFrom::Start(4))?;
        self.file.write_all(&(36 + data).to_le_bytes())?;
        self.file.seek(SeekFrom::Start(40))?;
        self.file.write_all(&data.to_le_bytes())?;
        self.file.seek(SeekFrom::Start(44 + self.data_bytes))?;
        self.file.flush()?;
        Ok(())
    }
}

/// PCM 오디오를 WAV 파일로 기록한다.
/// hound 대신 직접 헤더를 관리해, 강제종료 시에도 (주기적 flush 덕에) 재생 가능한
/// 부분 WAV가 디스크에 남도록 한다.
pub struct AudioRecorder {
    inner: Mutex<Option<Inner>>,
    path: String,
    paused: Mutex<bool>,
}

impl AudioRecorder {
    pub fn start(path: &str) -> Result<Self, String> {
        let file = File::create(path).map_err(|e| format!("WAV 파일 생성 실패: {}", e))?;
        let mut bw = BufWriter::new(file);
        write_wav_header(&mut bw, 0).map_err(|e| format!("WAV 헤더 기록 실패: {}", e))?;
        bw.flush().map_err(|e| e.to_string())?;

        log::info!("[AudioRecorder] 녹음 시작: {}", path);

        Ok(Self {
            inner: Mutex::new(Some(Inner {
                file: bw,
                data_bytes: 0,
                since_flush: 0,
            })),
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

    /// 믹싱된 PCM을 즉시 WAV에 기록한다. 일정 분량마다 헤더를 갱신·flush해 크래시 내성 확보.
    pub fn feed_mic(&self, samples: &[i16]) {
        if *self.paused.lock().unwrap() {
            return;
        }
        let mut lock = self.inner.lock().unwrap();
        if let Some(inner) = lock.as_mut() {
            for &s in samples {
                inner.file.write_all(&s.to_le_bytes()).ok();
            }
            let added = (samples.len() * 2) as u64;
            inner.data_bytes += added;
            inner.since_flush += added;
            if inner.since_flush >= HEADER_FLUSH_INTERVAL {
                inner.flush_header().ok();
                inner.since_flush = 0;
            }
        }
    }

    pub fn stop(&self) -> Result<String, String> {
        let mut lock = self.inner.lock().unwrap();
        if let Some(mut inner) = lock.take() {
            inner
                .flush_header()
                .map_err(|e| format!("WAV finalize 실패: {}", e))?;
        }
        log::info!("[AudioRecorder] 녹음 종료: {}", self.path);
        Ok(self.path.clone())
    }
}
