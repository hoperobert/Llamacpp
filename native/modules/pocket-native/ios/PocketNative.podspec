Pod::Spec.new do |s|
  s.name           = 'PocketNative'
  s.version        = '1.0.0'
  s.summary        = 'The few things Pocket LLM needs from iOS that no package offers.'
  s.description    = 'Carrying work on in the background, and reading the text of a PDF.'
  s.author         = 'Pocket LLM'
  s.homepage       = 'https://github.com/hoperobert/Llamacpp'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,mm,swift}'
end
