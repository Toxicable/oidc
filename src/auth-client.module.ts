import { NgModule, ModuleWithProviders } from '@angular/core';
import { OpenIdClientService } from './auth-client.service';
import { OpenIdClientConfig } from './config';

@NgModule({
  providers: [
    OpenIdClientService,
  ],
})
class RootOpenIdCLientModule { }

export class OpenIdClientModule {
  static withConfig(config: OpenIdClientConfig): ModuleWithProviders {
    return {
      ngModule: RootOpenIdCLientModule,
      providers: [
        { provide: 'config', useValue: config}
      ]
    }
  }

 }
