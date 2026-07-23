require "rails_helper"

# rubyzip 전역 설정 + EFS 플래그 실효 검증.
# Windows 탐색기는 central directory의 general purpose flag(bit 11=EFS)로
# 엔트리명 인코딩을 판정한다 — 이 비트가 없으면 한글이 CP949로 깨진다.
RSpec.describe "rubyzip initializer" do
  EFS_BIT = 0x0800

  it "unicode_names 가 전역 활성화되어 있다" do
    expect(Zip.unicode_names).to be(true)
  end

  it "한글 엔트리명 zip의 local·central 헤더 양쪽에 EFS 비트를 세운다" do
    buffer = Zip::OutputStream.write_buffer do |zos|
      zos.put_next_entry("한글폴더/회의록.md")
      zos.write("# 내용")
    end
    bytes = buffer.string.b

    # local file header: 시그니처 PK\x03\x04, flag 오프셋 6-7 (LE uint16)
    expect(bytes[0, 4]).to eq("PK\x03\x04".b)
    local_flags = bytes[6, 2].unpack1("v")
    expect(local_flags & EFS_BIT).to eq(EFS_BIT)

    # central directory header: 시그니처 PK\x01\x02, flag 오프셋 8-9
    cd = bytes.index("PK\x01\x02".b)
    expect(cd).not_to be_nil
    central_flags = bytes[cd + 8, 2].unpack1("v")
    expect(central_flags & EFS_BIT).to eq(EFS_BIT)

    # 엔트리명이 raw UTF-8 바이트로 기록됐는지
    name_len = bytes[26, 2].unpack1("v")
    expect(bytes[30, name_len].force_encoding("UTF-8")).to eq("한글폴더/회의록.md")
  end
end
