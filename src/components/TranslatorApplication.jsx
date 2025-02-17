"use client"
import React, { useEffect, useRef, useState } from 'react'
import { Button, Input, Card, Textarea, Slider, Switch, CardHeader, CardBody, Divider } from "@nextui-org/react";

import { EyeSlashFilledIcon } from './EyeSlashFilledIcon';
import { EyeFilledIcon } from './EyeFilledIcon';

import { FileUploadButton } from '@/components/FileUploadButton';
import { SubtitleCard } from '@/components/SubtitleCard';
import { downloadString } from '@/utils/download';
import { sampleSrt } from '@/data/sample';

import { Translator, TranslatorStructuredArray, subtitleParser, createOpenAIClient, CooldownContext } from "chatgpt-subtitle-translator"

const OPENAI_API_KEY = "OPENAI_API_KEY"
const OPENAI_BASE_URL = "OPENAI_BASE_URL"
const RATE_LIMIT = "RATE_LIMIT"

export function TranslatorApplication() {
  // Translator Configuration
  const [APIvalue, setAPIValue] = useState("")
  const [baseUrlValue, setBaseUrlValue] = useState(undefined)
  const [fromLanguage, setFromLanguage] = useState("")
  const [toLanguage, setToLanguage] = useState("Hinglish")
  const [systemInstruction, setSystemInstruction] = useState("")
  const [model, setModel] = useState("gpt-4o-mini")
  const [temperature, setTemperature] = useState(0)
  const [batchSizes, setBatchSizes] = useState([10, 50])
  const [useModerator, setUseModerator] = useState(true)
  const [useStructuredMode, setUseStructuredMode] = useState(true)
  const [rateLimit, setRateLimit] = useState(60)
  /** @type {React.MutableRefObject<HTMLInputElement>} */
  const configSection = useRef()
  const [isAPIInputVisible, setIsAPIInputVisible] = useState(false)
  const toggleAPIInputVisibility = () => setIsAPIInputVisible(!isAPIInputVisible)

  // Translator State
  const [srtInputText, setSrtInputText] = useState(sampleSrt)
  const [srtOutputText, setSrtOutputText] = useState(sampleSrt)
  const [inputs, setInputs] = useState(subtitleParser.fromSrt(sampleSrt).map(x => x.text))
  const [outputs, setOutput] = useState([]) // holds finished translations (line by line)
  const [streamOutput, setStreamOutput] = useState("")
  const [translatorRunningState, setTranslatorRunningState] = useState(false)
  /** @type {React.MutableRefObject<Translator>} */
  const translatorRef = useRef(null)
  const translatorRunningRef = useRef(false)

  // New state: resumeIndex (number of lines already translated) and error message
  const [resumeIndex, setResumeIndex] = useState(0)
  const [errorMessage, setErrorMessage] = useState("")

  // Translator Stats
  const [usageInformation, setUsageInformation] = useState(/** @type {typeof Translator.prototype.usage}*/(null))
  const [RPMInfomation, setRPMInformation] = useState(0)

  // Persistent Data Restoration
  useEffect(() => {
    setAPIValue(localStorage.getItem(OPENAI_API_KEY) ?? "")
    setRateLimit(Number(localStorage.getItem(RATE_LIMIT) ?? rateLimit))
    setBaseUrlWithModerator(localStorage.getItem(OPENAI_BASE_URL) ?? undefined)
  }, [])

  function setAPIKey(value) {
    localStorage.setItem(OPENAI_API_KEY, value)
    setAPIValue(value)
  }

  function setBaseUrl(value) {
    if (!value) {
      value = undefined
      localStorage.removeItem(OPENAI_BASE_URL)
    }
    if (value) {
      localStorage.setItem(OPENAI_BASE_URL, value)
    }
    setBaseUrlWithModerator(value)
  }

  function setBaseUrlWithModerator(value) {
    if (!baseUrlValue && value) {
      if (useModerator) {
        setUseModerator(false)
      }
      if (useStructuredMode) {
        setUseStructuredMode(false)
      }
    }
    setBaseUrlValue(value)
  }

  function setRateLimitValue(value) {
    localStorage.setItem(RATE_LIMIT, value)
    setRateLimit(Number(value))
  }

  // ---- New Translation Functions ----

  /**
   * startTranslation starts (or resumes) translation from a given index.
   * @param {number} startIndex - the index (0-based) to resume from.
   */
  async function startTranslation(startIndex = 0) {
    setErrorMessage("");
    setTranslatorRunningState(true);
    translatorRunningRef.current = true;
  
    // Parse the original SRT to get a working copy.
    const outputWorkingProgress = subtitleParser.fromSrt(srtInputText);
    // If resuming, preserve previous translations.
    let currentOutputs = startIndex > 0 ? outputs.slice(0, startIndex) : [];
  
    const openai = createOpenAIClient(APIvalue, true, baseUrlValue);
  
    const coolerChatGPTAPI = new CooldownContext(rateLimit, 60000, "ChatGPTAPI");
    const coolerOpenAIModerator = new CooldownContext(rateLimit, 60000, "OpenAIModerator");
  
    const TranslatorImplementation = useStructuredMode ? TranslatorStructuredArray : Translator;
  
    translatorRef.current = new TranslatorImplementation(
      { from: fromLanguage, to: toLanguage },
      {
        openai,
        cooler: coolerChatGPTAPI,
        onStreamChunk: (data) => {
          if (streamOutput === '' && data === "\n") {
            return;
          }
          setStreamOutput(prev => prev + data);
        },
        onStreamEnd: () => {
          setStreamOutput("");
        },
        onClearLine: () => {
          const progressLines = streamOutput.split("\n");
          if (progressLines[0] === "") {
            progressLines.shift();
          }
          progressLines.pop();
          const newStream = progressLines.join("\n") + "\n";
          setStreamOutput(newStream === "\n" ? "" : newStream);
        },
        moderationService: {
          openai,
          cooler: coolerOpenAIModerator
        }
      },
      {
        useModerator: useModerator,
        batchSizes: batchSizes,
        createChatCompletionRequest: {
          model: model,
          temperature: temperature,
          stream: true
        },
      }
    );
  
    if (systemInstruction) {
      translatorRef.current.systemInstruction = systemInstruction;
    }
  
    try {
      setStreamOutput("");
      // Only translate the remaining inputs.
      const inputsToTranslate = inputs.slice(startIndex);
      for await (const output of translatorRef.current.translateLines(inputsToTranslate)) {
        if (!translatorRunningRef.current) {
          console.error("[User Interface]", "Aborted");
          break;
        }
        // Adjust index: translator yields index starting at 1 for the sliced array.
        const overallIndex = startIndex + (output.index - 1);
        currentOutputs[overallIndex] = output.finalTransform;
  
        // Update the SRT working copy.
        const srtEntry = outputWorkingProgress[overallIndex];
        srtEntry.text = output.finalTransform;
  
        // Update state with current progress.
        setOutput([...currentOutputs]);
        setUsageInformation(translatorRef.current.usage);
        setRPMInformation(translatorRef.current.services.cooler?.rate);
  
        // **New Change:** Update the srtOutputText continuously so the latest translated text is exported.
        setSrtOutputText(subtitleParser.toSrt(outputWorkingProgress));
      }
      // Update resumeIndex based on translation progress.
      if (currentOutputs.length >= inputs.length) {
        setResumeIndex(0);
      } else {
        setResumeIndex(currentOutputs.length);
      }
    } catch (error) {
      console.error(error);
      setErrorMessage(error?.message ?? String(error));
      setResumeIndex(currentOutputs.length);
      // Also update the srt output text with the progress so far.
      setSrtOutputText(subtitleParser.toSrt(outputWorkingProgress));
    } finally {
      translatorRunningRef.current = false;
      translatorRef.current = null;
      setTranslatorRunningState(false);
    }
  }
  

  // Called when user manually stops translation.
  async function stopGeneration() {
    console.error("[User Interface]", "Aborting")
    if (translatorRef.current) {
      translatorRunningRef.current = false
      translatorRef.current.abort()
    }
  }

  // When user clicks "Start Over", clear previous progress and start from line 0.
  async function handleStartOver(e) {
    e.preventDefault();
    // Clear previous outputs & resume index.
    setOutput([]);
    setResumeIndex(0);
    await startTranslation(0);
  }

  // When user clicks "Resume", resume from the last successfully translated line.
  async function handleResume() {
    await startTranslation(resumeIndex);
  }

  // ---- End New Translation Functions ----

  return (
    <>
      <div className='w-full'>
        <form id="translator-config-form" onSubmit={handleStartOver}>
          <div className='px-4 pt-4 flex flex-wrap justify-between w-full gap-4'>
            <Card className="z-10 w-full shadow-md border" shadow="none">
              <CardHeader className="flex gap-3 pb-0">
                <div className="flex flex-col">
                  <p className="text-md">Configuration</p>
                </div>
              </CardHeader>
              <CardBody>
                <div className='flex flex-wrap justify-between w-full gap-4'>
                  <div className='flex flex-wrap md:flex-nowrap w-full gap-4'>
                    <Input
                      className="w-full md:w-6/12"
                      size='sm'
                      value={APIvalue}
                      onValueChange={(value) => setAPIKey(value)}
                      isRequired
                      autoComplete='off'
                      label="OpenAI API Key"
                      variant="flat"
                      description="API Key is stored locally in browser. No Need of API Key if you are using @Cybrion Base URL."
                      endContent={
                        <button className="focus:outline-none" type="button" onClick={toggleAPIInputVisibility}>
                          {isAPIInputVisible ? (
                            <EyeSlashFilledIcon className="text-2xl text-default-400 pointer-events-none" />
                          ) : (
                            <EyeFilledIcon className="text-2xl text-default-400 pointer-events-none" />
                          )}
                        </button>
                      }
                      type={isAPIInputVisible ? "text" : "password"}
                    />
                    <Input
                      className='w-full md:w-6/12'
                      size='sm'
                      type="text"
                      label="OpenAI Base Url"
                      placeholder="https://api.openai.com/v1"
                      autoComplete='on'
                      value={baseUrlValue ?? ""}
                      description="Get Base URL for FREE UNLIMTED API USE from @Cybrion"
                      onValueChange={setBaseUrl}
                    />
                  </div>

                  <div className='flex w-full gap-4'>
                    <Input
                      className='w-full md:w-6/12'
                      size='sm'
                      type="text"
                      label="From Language"
                      placeholder="Auto"
                      autoComplete='on'
                      value={fromLanguage}
                      onValueChange={setFromLanguage}
                    />
                    <Input
                      className='w-full md:w-6/12'
                      size='sm'
                      type="text"
                      label="To Language"
                      autoComplete='on'
                      value={toLanguage}
                      onValueChange={setToLanguage}
                    />
                  </div>

                  <div className='w-full'>
                    <Textarea
                      label="System Instruction"
                      minRows={2}
                      description={"Override preset system instruction. Use System Instruction to guide AI Models to generate more accurate results."}
                      placeholder={`Translate ${fromLanguage ? fromLanguage + " " : ""}to ${toLanguage}`}
                      value={systemInstruction}
                      onValueChange={setSystemInstruction}
                    />
                  </div>

                  <div className='flex flex-wrap md:flex-nowrap w-full gap-4'>
                    <div className='w-full md:w-1/6'>
                      <Input
                        size='sm'
                        type="text"
                        label="Model"
                        autoComplete='on'
                        value={model}
                        onValueChange={setModel}
                      />
                    </div>

                    <div className='w-full md:w-1/6 flex'>
                      <Switch
                        size='sm'
                        isSelected={useStructuredMode}
                        onValueChange={setUseStructuredMode}
                      >
                      </Switch>
                      <div className="flex flex-col place-content-center gap-1">
                        <p className="text-small">Use Structured Mode</p>
                        {baseUrlValue && (
                          <p className="text-tiny text-default-400">
                            Base URL is set, disable structured mode for compatibility.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className='w-full md:w-1/6'>
                      <Slider
                        label="Temperature"
                        size="md"
                        hideThumb={true}
                        step={0.05}
                        maxValue={2}
                        minValue={0}
                        value={temperature}
                        onChange={(e) => setTemperature(Number(e))}
                      />
                    </div>

                    <div className='w-full md:w-1/6'>
                      <Slider
                        label="Batch Sizes"
                        size="md"
                        step={10}
                        maxValue={200}
                        minValue={10}
                        value={batchSizes}
                        onChange={(e) => typeof e === "number" ? setBatchSizes([e]) : setBatchSizes(e)}
                      />
                    </div>

                    <div className='w-full md:w-2/6 gap-4 flex flex-wrap md:flex-nowrap'>
                      <div className='w-full md:w-6/12 flex'>
                        <Switch
                          size='sm'
                          isSelected={useModerator}
                          onValueChange={setUseModerator}
                        >
                        </Switch>
                        <div className="flex flex-col place-content-center gap-1">
                          <p className="text-small">Use Moderator</p>
                          {baseUrlValue && (
                            <p className="text-tiny text-default-400">
                              Base URL is set, disable moderator for compatibility.
                            </p>
                          )}
                        </div>
                      </div>

                      <Input
                        className='w-full md:w-6/12'
                        size='sm'
                        type="number"
                        min="1"
                        label="Rate Limit"
                        value={rateLimit.toString()}
                        onValueChange={(value) => setRateLimitValue(value)}
                        autoComplete='on'
                        endContent={
                          <div className="pointer-events-none flex items-center">
                            <span className="text-default-400 text-small">RPM</span>
                          </div>
                        }
                      />
                    </div>
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>
        </form>

        {/* Button Panel */}
        <div className='w-full justify-between md:justify-center flex flex-wrap gap-1 sm:gap-4 mt-auto sticky top-0 backdrop-blur px-4 pt-4'>
          <FileUploadButton label={"Import SRT"} onFileSelect={async (file) => {
            try {
              const text = await file.text()
              const parsed = subtitleParser.fromSrt(text)
              setSrtInputText(text)
              setInputs(parsed.map(x => x.text))
              // Reset progress when a new file is imported
              setOutput([]);
              setResumeIndex(0);
            } catch (error) {
              alert(error.message ?? error)
            }
          }} />
          {translatorRunningState ? (
            <Button color="danger" onClick={stopGeneration} isLoading={!streamOutput}>
              Stop
            </Button>
          ) : (
            <>
              {/* If some progress exists and not complete, show both Resume and Start Over */}
              {resumeIndex > 0 && resumeIndex < inputs.length ? (
                <>
                  <Button type='submit' form="translator-config-form" color="primary" isDisabled={!APIvalue || translatorRunningState}>
                    Start Over
                  </Button>
                  <Button color="primary" onClick={handleResume} isDisabled={!APIvalue || translatorRunningState}>
                    Resume ({resumeIndex}/{inputs.length})
                  </Button>
                </>
              ) : (
                <Button type='submit' form="translator-config-form" color="primary" isDisabled={!APIvalue || translatorRunningState}>
                  Start
                </Button>
              )}
            </>
          )}

          <Button color="primary" onClick={() => {
            downloadString(srtOutputText, "text/plain", "export.srt")
          }}>
            Export SRT
          </Button>
          <Divider className='mt-3 sm:mt-0' />
        </div>

        {/* Progress and Error Info */}
        <div className="px-4 mt-4">
          <p className="text-sm">
            Translated: {outputs.length} / {inputs.length}
          </p>
          {errorMessage && (
            <Card className="mt-2 border border-danger bg-danger/10">
              <p className="text-danger p-2">Error: {errorMessage}</p>
            </Card>
          )}
        </div>

        <div className="lg:flex lg:gap-4 px-4 mt-4">
          <div className="lg:w-1/2">
            <SubtitleCard label={"Input"}>
              <ol className="py-2 list-decimal line-marker ">
                {inputs.map((line, i) => (
                  <li key={i}>
                    <div className='ml-4 truncate'>
                      {line}
                    </div>
                  </li>
                ))}
              </ol>
            </SubtitleCard>
          </div>

          <div className="lg:w-1/2">
            <SubtitleCard label={"Output"}>
              <ol className="py-2 list-decimal line-marker ">
                {outputs.map((line, i) => (
                  <li key={i}>
                    <div className='ml-4 truncate'>
                      {line}
                    </div>
                  </li>
                ))}
                <pre className='px-2 whitespace-pre-wrap'>
                  {streamOutput}
                </pre>
              </ol>
            </SubtitleCard>

            {usageInformation && (
              <Card shadow="sm" className='mt-4 p-4'>
                <span><b>Estimated Usage</b></span>
                <span>Tokens: {usageInformation?.usedTokens} ${usageInformation?.usedTokensPricing}</span>
                {usageInformation?.wastedTokens > 0 && (
                  <span className={'text-danger'}>Wasted: {usageInformation?.wastedTokens} ${usageInformation?.wastedTokensPricing} {usageInformation?.wastedPercent}</span>
                )}
                {usageInformation?.cachedTokens > 0 && (
                  <span className={'text-success'}>Cached: {usageInformation?.cachedTokens}</span>
                )}
                <span>{usageInformation?.rate} TPM {RPMInfomation} RPM</span>
              </Card>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
