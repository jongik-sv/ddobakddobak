// speakrs(Rust/CoreML) diarization CLI wrapper.
// Input: PCM s16le 16kHz mono (positional). Output stdout JSON:
//   {"speakers":["화자 1",...],"turns":[{"start_ms":int,"end_ms":int,"speaker":"화자 N"}]}
// Option: --ahc-threshold <f32> (default 0.4). Lower = split speakers more (distance cutoff).
// ExecutionMode: macOS=CoreMl(FP32 ~1s step), 그 외=Cpu. SPEAKRS_MODE(cpu|cuda|coreml)로 오버라이드.
// stderr carries [speakrs-cli] timing logs.

use speakrs::{ExecutionMode, OwnedDiarizationPipeline, PipelineConfig};
use std::collections::HashMap;
use std::io::Read;
use std::time::Instant;

fn main() {
    // --- args ---
    let mut pcm_path: Option<String> = None;
    let mut ahc_threshold: f32 = 0.4;
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--ahc-threshold" => {
                let v = it.next().unwrap_or_else(|| die("--ahc-threshold needs a value"));
                ahc_threshold = v
                    .parse()
                    .unwrap_or_else(|_| die("--ahc-threshold must be a float"));
            }
            other if pcm_path.is_none() => pcm_path = Some(other.to_string()),
            _ => {}
        }
    }
    let pcm_path = pcm_path
        .unwrap_or_else(|| die("usage: speakrs-cli <pcm_s16le_16k_mono> [--ahc-threshold <f32>]"));

    // --- load s16le PCM -> f32 mono 16k ---
    let mut buf = Vec::new();
    std::fs::File::open(&pcm_path)
        .unwrap_or_else(|e| die(&format!("open pcm: {e}")))
        .read_to_end(&mut buf)
        .unwrap_or_else(|e| die(&format!("read pcm: {e}")));
    let audio: Vec<f32> = buf
        .chunks_exact(2)
        .map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0)
        .collect();
    eprintln!(
        "[speakrs-cli] loaded {} samples = {:.1}s",
        audio.len(),
        audio.len() as f32 / 16000.0
    );

    // --- diarize. Prefer SPEAKRS_MODELS_DIR if set, else HF cache. ---
    let mode = exec_mode();
    eprintln!("[speakrs-cli] execution mode: {mode:?}");
    let t0 = Instant::now();
    let mut pipeline = match std::env::var("SPEAKRS_MODELS_DIR") {
        Ok(dir) => OwnedDiarizationPipeline::from_dir(dir, mode),
        Err(_) => OwnedDiarizationPipeline::from_pretrained(mode),
    }
    .unwrap_or_else(|e| die(&format!("build pipeline: {e:?}")));
    let mut cfg = PipelineConfig::default(); // == for_mode(CoreMl): 20 VBx iters
    cfg.ahc.threshold = ahc_threshold;
    let res = pipeline
        .run_with_config(&audio, "audio", &cfg)
        .unwrap_or_else(|e| die(&format!("diarize: {e:?}")));
    eprintln!(
        "[speakrs-cli] diarized in {:.1}s, threshold={:.2}, {} segments",
        t0.elapsed().as_secs_f32(),
        ahc_threshold,
        res.segments.len()
    );

    // --- map raw "SPEAKER_NN" -> "화자 N" in first-appearance(time) order ---
    let mut segs = res.segments.clone();
    segs.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap_or(std::cmp::Ordering::Equal));

    let mut label_map: HashMap<String, String> = HashMap::new();
    let mut ordered: Vec<String> = Vec::new();
    let mut turns = String::new();
    for (i, s) in segs.iter().enumerate() {
        let label = label_map
            .entry(s.speaker.clone())
            .or_insert_with(|| {
                let name = format!("화자 {}", ordered.len() + 1);
                ordered.push(name.clone());
                name
            })
            .clone();
        if i > 0 {
            turns.push(',');
        }
        let start_ms = (s.start * 1000.0).round() as i64;
        let end_ms = (s.end * 1000.0).round() as i64;
        turns.push_str(&format!(
            "{{\"start_ms\":{start_ms},\"end_ms\":{end_ms},\"speaker\":\"{label}\"}}"
        ));
    }
    let speakers = ordered
        .iter()
        .map(|s| format!("\"{s}\""))
        .collect::<Vec<_>>()
        .join(",");
    println!("{{\"speakers\":[{speakers}],\"turns\":[{turns}]}}");
}

// SPEAKRS_MODE 환경변수(cpu|cuda|coreml) 우선, 없으면 플랫폼 기본값.
fn exec_mode() -> ExecutionMode {
    match std::env::var("SPEAKRS_MODE").ok().as_deref() {
        Some("cpu") => ExecutionMode::Cpu,
        Some("cuda") => ExecutionMode::Cuda,
        Some("coreml") => ExecutionMode::CoreMl,
        Some(other) => die(&format!("unknown SPEAKRS_MODE: {other} (cpu|cuda|coreml)")),
        None => default_mode(),
    }
}

#[cfg(target_os = "macos")]
fn default_mode() -> ExecutionMode {
    ExecutionMode::CoreMl
}

#[cfg(not(target_os = "macos"))]
fn default_mode() -> ExecutionMode {
    ExecutionMode::Cpu
}

fn die(msg: &str) -> ! {
    eprintln!("[speakrs-cli] {msg}");
    std::process::exit(1);
}
