import { TranslatorApplication } from '@/components/TranslatorApplication';
import { basePath } from '@/../next.config';
import { Link } from '@nextui-org/react';

export default function Home() {
  return (
    <>
      <main className='min-h-screen flex flex-col justify-between'>
        <TranslatorApplication />
        <footer className="flex w-full my-4">
          <div className='mx-auto'>
            <h1 className='text-center'><b className='w-full'>AI Subtitle Translator Web Graphical User Interface</b></h1>
            <div className='flex flex-wrap items-center justify-center'>
              <div className='sm:w-auto text-center'>
                <Link isExternal className='mr-2 text-blue-500' href="https://t.me/Cerlancism">
                  @Cybrion
                </Link>
              </div>
            </div>
          </div>
        </footer>
      </main>

    </>
  )
}
