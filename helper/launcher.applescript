on startHelper()
  set resources to (POSIX path of (path to me)) & "Contents/Resources/"
  try
    set progress total steps to -1
    set progress description to "도우미를 준비하는 중입니다"
    set progress additional description to "처음에는 Blender 실행 환경을 내려받습니다."
    with timeout of 1800 seconds
      do shell script quoted form of (resources & "install.sh")
    end timeout
  on error messageText number errorNumber
    if errorNumber is not -128 then display alert "도우미를 준비하지 못했습니다" message messageText as critical
  end try
end startHelper

on run
  startHelper()
end run

on open location requestedURL
  if requestedURL is "giraffe-studio://open" or requestedURL is "giraffe-studio://open/" then startHelper()
end open location
