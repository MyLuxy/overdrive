#include <dirent.h>
#include "archives.hpp"
#include "archive_preflight.hpp"
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <thread>
#include <unistd.h>
// ARCHIVE_TRACE=1 prints the extraction steps, the throughput breakdown among them.
void archives::trace(const char* step,const char* detail){
 if(std::getenv("ARCHIVE_TRACE"))std::cerr<<step<<" "<<detail<<"\n";

 // Simulate a package disappearing before the artifact classification starts.
 static std::string staging;
 if(!std::strcmp(step,"staging ok"))staging=detail;

 const char* removed=std::getenv("ARCHIVE_REMOVE_AFTER_WRITE");
 if(!removed||*detail)return;
 if(std::strcmp(step,"read")&&std::strcmp(step,"rar worker finished"))return;
 if(unlink((staging+"/"+removed).c_str()))std::abort();
}
// ARCHIVE_PIPELINE_BYTES=0 exercises the inline writer.
std::size_t archives::pipeline_bytes(){const char* v=std::getenv("ARCHIVE_PIPELINE_BYTES");return v?std::strtoull(v,nullptr,10):32u<<20;}
// ARCHIVE_NO_MEMORY=1 reports a heap without room for an in-process extraction.
bool archives::hold_memory(bool hold){return !hold||!std::getenv("ARCHIVE_NO_MEMORY");}
// ARCHIVE_DOWNLOADING=1 asks rar-extract for the thread count used while downloads run.
bool archives::downloading(){return std::getenv("ARCHIVE_DOWNLOADING")!=nullptr;}
// True once `s` has ended. ARCHIVE_PHASES=1 prints to stderr each phase the polls see, then the files synced
// of the total and the declared total at the end.
bool ended(const archives::Snapshot& s){
 const bool last=s.state=="completed"||s.state=="failed"||s.state=="cancelled";
 static std::string seen;if(!std::getenv("ARCHIVE_PHASES"))return last;
 if(s.phase!=seen)std::cerr<<"phase "<<(seen=s.phase)<<"\n";
 if(last){std::cerr<<"synced "<<s.synced<<"/"<<s.sync_total<<"\ntotal "<<s.total<<"\n";seen.clear();}
 return last;}
bool archives::list_directory(const char* path,void(*visit)(const char*,void*),void* user){
 DIR* d=opendir(path);if(!d)return false;while(auto* e=readdir(d))visit(e->d_name,user);closedir(d);return true;}
int main(int argc,char** argv){
 if(argc>2&&std::string(argv[1])=="inspect"){
  int first=2;
  if(argc>4&&std::string(argv[2])=="--budget"){archives::inspect_budget=std::chrono::milliseconds(std::stol(argv[3]));first=4;}
  const auto inspection=archives::inspect(std::vector<std::string>(argv+first,argv+argc));
  std::cout<<inspection.kind<<"\n"<<inspection.refusal<<"\n";return 0;}
 if(argc<4)return 2;
 archives::Request request;request.destination=argv[1];request.max_bytes=std::stoull(argv[2]);
 // --stream: later volumes may appear while it runs; --cancel-after <ms> cancels it then; --again <worker>
 // runs the same request once more in this process with that rar-extract.
 long cancel_after=-1;const char* again=nullptr;
 for(int i=3;i<argc;i++){
  if(std::string(argv[i])=="--password"&&i+1<argc)request.password=argv[++i];
  else if(std::string(argv[i])=="--stream")request.stream=true;
  else if(std::string(argv[i])=="--cancel-after"&&i+1<argc)cancel_after=std::stol(argv[++i]);
  else if(std::string(argv[i])=="--again"&&i+1<argc)again=argv[++i];
  else request.sources.emplace_back(argv[i]);
 }
 const auto copy=request;
 std::string error;auto id=archives::enqueue(std::move(request),error);
 if(!id){std::cout<<"failed\n"<<error;return 0;}
 auto started=std::chrono::steady_clock::now();
 while(true){for(const auto& s:archives::poll())if(ended(s)){
  if(std::getenv("ARCHIVE_ARTIFACTS")){
   for(const auto& path:s.artifacts)std::cerr<<"artifact "<<path<<"\n";
  }
  std::cout<<s.state<<"\n"<<s.written<<"\n"<<s.error;
  if(!again){archives::stop();return 0;}
  std::cout<<"\n";setenv("PS5_REACT_RAR_WORKER",again,1);again=nullptr;cancel_after=-1;
  if(!(id=archives::enqueue(copy,error))){std::cout<<"failed\n"<<error;return 0;}
  started=std::chrono::steady_clock::now();}
 if(cancel_after>=0&&std::chrono::steady_clock::now()-started>=std::chrono::milliseconds(cancel_after)){archives::cancel(id);cancel_after=-1;}
 std::this_thread::sleep_for(std::chrono::milliseconds(10));}
}
